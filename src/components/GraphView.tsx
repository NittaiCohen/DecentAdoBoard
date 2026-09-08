import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useKeyDown } from "../hooks/useKeyDown";
import {
  Background,
  BackgroundVariant,
  type Connection,
  ControlButton,
  Controls,
  type Edge,
  type EdgeMouseHandler,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQueryClient } from "@tanstack/react-query";
import type { BoardData, WorkItem } from "../types";
import WorkItemNodeComponent from "./WorkItemNode";
import SprintDividerComponent from "./SprintDivider";
import ParentGroupComponent from "./ParentGroup";
import DragGhostComponent from "./DragGhost";
import DependencyEdge from "./DependencyEdge";
import DebugObstacles from "./DebugObstacles";
import { BOARD_NODE_TYPES } from "../types/graph";
import {
  buildGraphLayout,
  buildNodePositions,
  NODE_GAP_Y,
  NODE_HEIGHT,
} from "../utils/graphLayout";
import { assignLaneOffsets } from "../utils/edgeRouting";
import { wouldCreateCycle } from "../utils/dependencies";
import { extractWorkItemId, useDragReorder } from "../hooks/useDragReorder";
import { useExpandedParents } from "../hooks/useExpandedParents";
import type {
  IterationChange,
  OperationContext,
  ReversibleOperation,
} from "../utils/reversibleOperations";
import { applyOperation } from "../utils/reversibleOperations";

interface GraphViewProps {
  boardData?: BoardData;
  operationContextRef?: React.RefObject<OperationContext | null>;
  pushUndo?: (op: ReversibleOperation) => void;
  undo?: () => void;
  redo?: () => void;
  readOnly?: boolean;
  previewActions?: GraphPreviewActions;
  onOpenWorkItem?: (workItemId: number) => void;
}

export interface GraphPreviewActions {
  onStateChange: (workItemId: number, newState: string) => void;
  onIterationChange: (iterationChanges: IterationChange[]) => void;
  onAddDependency: (sourceId: number, targetId: number) => void;
  onRemoveDependency: (sourceId: number, targetId: number) => void;
}

interface GraphViewInnerProps {
  boardData?: BoardData;
  operationContextRef: React.RefObject<OperationContext | null>;
  pushUndo: (op: ReversibleOperation) => void;
  undo: () => void;
  redo: () => void;
  readOnly: boolean;
  previewActions?: GraphPreviewActions;
  onOpenWorkItem?: (workItemId: number) => void;
}

const NO_OP = () => {};
const NO_OP_OPERATION = (_operation: ReversibleOperation) => {};

const nodeTypes: NodeTypes = {
  workItem: WorkItemNodeComponent,
  sprintDivider: SprintDividerComponent,
  parentGroup: ParentGroupComponent,
  dragGhost: DragGhostComponent,
};

const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge,
};

/** Set to true to draw red obstacle rectangles on the graph. */
const DEBUG_MODE = false;
const DEBUG_SHOW_OBSTACLES = DEBUG_MODE;
const DEFAULT_COLLISION_NODE_WIDTH = 220;
const DEFAULT_COLLISION_NODE_HEIGHT = NODE_HEIGHT;
const COLLISION_GROUP_PADDING = 20;

const COLLISION_NODE_TYPES = new Set<string>([
  BOARD_NODE_TYPES.workItem,
  BOARD_NODE_TYPES.parentGroup,
]);

function getNodeDimension(node: Node, dimension: "width" | "height"): number {
  const styledDimension = node.style?.[dimension];
  if (typeof styledDimension === "number") {
    return styledDimension;
  }
  if (typeof styledDimension === "string") {
    const parsedDimension = Number(styledDimension);
    if (!Number.isNaN(parsedDimension)) {
      return parsedDimension;
    }
  }

  const measuredDimension = node.measured?.[dimension];
  if (measuredDimension !== undefined) {
    return measuredDimension;
  }

  return dimension === "width" ? DEFAULT_COLLISION_NODE_WIDTH : DEFAULT_COLLISION_NODE_HEIGHT;
}

function buildNodeDepthMap(nodes: Node[]): Map<string, number> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeDepths = new Map<string, number>();
  const visitingNodeIds = new Set<string>();

  const getNodeDepth = (nodeId: string): number => {
    const cachedDepth = nodeDepths.get(nodeId);
    if (cachedDepth !== undefined) {
      return cachedDepth;
    }

    if (visitingNodeIds.has(nodeId)) {
      throw new Error(`Cycle detected in node parent hierarchy at "${nodeId}".`);
    }

    const node = nodesById.get(nodeId);
    if (!node?.parentId || !nodesById.has(node.parentId)) {
      nodeDepths.set(nodeId, 0);
      return 0;
    }

    visitingNodeIds.add(nodeId);
    const depth = getNodeDepth(node.parentId) + 1;
    visitingNodeIds.delete(nodeId);
    nodeDepths.set(nodeId, depth);
    return depth;
  };

  nodes.forEach((node) => getNodeDepth(node.id));

  return nodeDepths;
}

function resolveSiblingOverlaps(siblings: Node[], updatedNodes: Map<string, Node>): number {
  const updatedSiblings = siblings
    .map((node) => updatedNodes.get(node.id) ?? node)
    .sort((first, second) => {
      if (first.position.y !== second.position.y) {
        return first.position.y - second.position.y;
      }
      return first.position.x - second.position.x;
    });

  let maxBottom = 0;
  for (let index = 0; index < updatedSiblings.length; index++) {
    const node = updatedSiblings[index];
    let resolvedY = node.position.y;
    const nodeWidth = getNodeDimension(node, "width");
    const nodeHeight = getNodeDimension(node, "height");

    for (let previousIndex = 0; previousIndex < index; previousIndex++) {
      const previousNode = updatedSiblings[previousIndex];
      const previousWidth = getNodeDimension(previousNode, "width");
      const previousHeight = getNodeDimension(previousNode, "height");
      const overlapsHorizontally =
        node.position.x < previousNode.position.x + previousWidth &&
        node.position.x + nodeWidth > previousNode.position.x;

      if (overlapsHorizontally) {
        resolvedY = Math.max(resolvedY, previousNode.position.y + previousHeight + NODE_GAP_Y);
      }
    }

    if (resolvedY !== node.position.y) {
      const updatedNode = {
        ...node,
        position: { ...node.position, y: resolvedY },
      };
      updatedNodes.set(node.id, updatedNode);
      updatedSiblings[index] = updatedNode;
    }

    maxBottom = Math.max(maxBottom, resolvedY + nodeHeight);
  }

  return maxBottom;
}

function resolveNodeOverlaps(nodes: Node[]): Node[] {
  const nodeDepths = buildNodeDepthMap(nodes);
  const nodesByParent = new Map<string | undefined, Node[]>();
  nodes
    .filter((node) => node.type !== undefined && COLLISION_NODE_TYPES.has(node.type))
    .forEach((node) => {
      const siblings = nodesByParent.get(node.parentId);
      if (siblings) {
        siblings.push(node);
      } else {
        nodesByParent.set(node.parentId, [node]);
      }
    });

  const updatedNodes = new Map(nodes.map((node) => [node.id, node]));
  const parentGroups = nodes
    .filter((node) => node.type === BOARD_NODE_TYPES.parentGroup)
    .sort((first, second) => {
      const firstDepth = nodeDepths.get(first.id) ?? 0;
      const secondDepth = nodeDepths.get(second.id) ?? 0;
      return secondDepth - firstDepth;
    });

  for (const group of parentGroups) {
    const children = nodesByParent.get(group.id) ?? [];
    const maxChildBottom = resolveSiblingOverlaps(children, updatedNodes);

    const currentHeight = getNodeDimension(group, "height");
    const requiredHeight = maxChildBottom + COLLISION_GROUP_PADDING;
    if (requiredHeight > currentHeight) {
      const updatedGroup = {
        ...group,
        style: { ...group.style, height: requiredHeight },
        data:
          group.data && typeof group.data === "object"
            ? { ...group.data, height: requiredHeight }
            : group.data,
      };
      updatedNodes.set(group.id, updatedGroup);
    }
  }

  for (const [parentId, siblings] of nodesByParent) {
    if (parentId !== undefined) {
      continue;
    }

    resolveSiblingOverlaps(siblings, updatedNodes);
  }

  return nodes.map((node) => updatedNodes.get(node.id) ?? node);
}

export default function GraphView({
  boardData,
  operationContextRef,
  pushUndo = NO_OP_OPERATION,
  undo = NO_OP,
  redo = NO_OP,
  readOnly = false,
  previewActions,
  onOpenWorkItem,
}: GraphViewProps) {
  const internalOperationContextRef = useRef<OperationContext>(null);

  return (
    <ReactFlowProvider>
      <GraphViewInner
        boardData={boardData}
        operationContextRef={operationContextRef ?? internalOperationContextRef}
        pushUndo={pushUndo}
        undo={undo}
        redo={redo}
        readOnly={readOnly}
        previewActions={previewActions}
        onOpenWorkItem={onOpenWorkItem}
      />
    </ReactFlowProvider>
  );
}

const SCROLL_ZOOM_SENSITIVITY = 0.01;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 100;
const ZOOM_FACTOR = 1.25;
const ZOOM_ANIMATION_DURATION_MS = 150;
const FIT_VIEW_ANIMATION_DURATION_MS = 300;
const BACKGROUND_GRID_GAP = 16;
const BACKGROUND_DOT_SIZE = 1;

function GraphViewInner({
  boardData,
  operationContextRef,
  pushUndo,
  undo,
  redo,
  readOnly,
  previewActions,
  onOpenWorkItem,
}: GraphViewInnerProps) {
  const [expandedParents, handleToggleExpand] = useExpandedParents(boardData);
  const { setViewport, getViewport, fitView } = useReactFlow();
  const queryClient = useQueryClient();

  const wiMap = useMemo(() => {
    const map = new Map<number, WorkItem>();
    if (boardData) {
      boardData.work_items.forEach((workItem) => {
        map.set(workItem.id, workItem);
      });
    }
    return map;
  }, [boardData]);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (!boardData) {
      return { nodes: [], edges: [] };
    }

    const result = buildGraphLayout(boardData, expandedParents);

    return {
      nodes: result.nodes.map((node) => {
        if (node.type === BOARD_NODE_TYPES.workItem || node.type === BOARD_NODE_TYPES.parentGroup) {
          return {
            ...node,
            data: {
              ...node.data,
              onToggleExpand: handleToggleExpand,
              previewMode: previewActions !== undefined,
              onPreviewStateChange: previewActions?.onStateChange,
              onOpenOverview: onOpenWorkItem,
            },
          };
        }
        return node;
      }),
      edges: result.edges,
    };
  }, [boardData, expandedParents, handleToggleExpand, onOpenWorkItem, previewActions]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Tracks which layoutNodes identity has already been routed, so we only
  // route edges once per layout change after ReactFlow measures nodes.
  const routedLayoutRef = useRef<unknown>(null);

  useEffect(() => {
    routedLayoutRef.current = null;
    setNodes(() => layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  // Re-route edges once ReactFlow has measured node dimensions
  useEffect(() => {
    if (routedLayoutRef.current === layoutNodes) {
      return;
    }
    const measuredNodes = nodes.filter(
      (node) => node.type !== undefined && COLLISION_NODE_TYPES.has(node.type),
    );
    const allMeasured =
      measuredNodes.length > 0 &&
      measuredNodes.every(
        (node) => node.measured?.height !== undefined || node.style?.height !== undefined,
      );
    if (!allMeasured) {
      return;
    }
    routedLayoutRef.current = layoutNodes;
    const reflowedNodes = resolveNodeOverlaps(nodes);
    if (reflowedNodes.some((node, index) => node !== nodes[index])) {
      setNodes(reflowedNodes);
    }
    const { positions: nodePositions, parentMap } = buildNodePositions(reflowedNodes);
    setEdges((prev) => assignLaneOffsets(prev, nodePositions, parentMap));
  }, [nodes, layoutNodes, setEdges, setNodes]);

  const handleDragSettled = useCallback(
    (finalNodes: Node[]) => {
      const { positions: nodePositions, parentMap } = buildNodePositions(finalNodes);
      setEdges((prev) => assignLaneOffsets(prev, nodePositions, parentMap));
    },
    [setEdges],
  );

  const handleSprintChange = useCallback(
    (iterationChanges: IterationChange[]) => {
      if (previewActions) {
        previewActions.onIterationChange(iterationChanges);
        return;
      }
      if (readOnly) {
        return;
      }
      const ctx = operationContextRef.current;
      if (!ctx) {
        return;
      }

      iterationChanges
        .filter((iterationChange) => {
          const workItem = wiMap.get(iterationChange.workItemId);
          return workItem && workItem.iteration_path !== iterationChange.toIterationPath;
        })
        .map(
          (iterationChange): ReversibleOperation => ({
            ...iterationChange,
            type: "changeWorkItemIteration",
          }),
        )
        .forEach((operation) => applyOperation(operation, ctx));
    },
    [wiMap, operationContextRef, previewActions, readOnly],
  );

  useEffect(() => {
    if (readOnly) {
      return;
    }
    operationContextRef.current = { queryClient, setNodes, onDragSettled: handleDragSettled };
  }, [handleDragSettled, operationContextRef, queryClient, readOnly, setNodes]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) {
        return;
      }
      const sourceId = extractWorkItemId(connection.source);
      const targetId = extractWorkItemId(connection.target);
      if (sourceId === undefined || targetId === undefined || isNaN(sourceId) || isNaN(targetId)) {
        return;
      }

      if (wouldCreateCycle(sourceId, targetId, wiMap)) {
        return;
      }

      if (previewActions) {
        previewActions.onAddDependency(sourceId, targetId);
        return;
      }

      const ctx = operationContextRef.current;
      if (!ctx) {
        return;
      }

      const op: ReversibleOperation = {
        type: "addDependencyRelation",
        sourceId,
        targetId,
      };

      applyOperation(op, ctx);
      pushUndo(op);
    },
    [wiMap, pushUndo, operationContextRef, previewActions, readOnly],
  );

  const handleEdgeClick = useCallback<EdgeMouseHandler>((event, edge) => {
    if (!DEBUG_MODE || edge.type !== "dependency") {
      return;
    }

    // React Flow's interaction path receives edge clicks, so log from its edge event.
    // eslint-disable-next-line no-console
    console.log("[GraphView] dependency edge clicked", {
      event: {
        clientX: event.clientX,
        clientY: event.clientY,
      },
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: edge.data,
    });
  }, []);

  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      if (readOnly) {
        return;
      }
      const ctx = operationContextRef.current;
      if (!ctx && !previewActions) {
        return;
      }
      const operationContext = ctx;
      deletedEdges.forEach((edge) => {
        const sourceId = extractWorkItemId(edge.source);
        const targetId = extractWorkItemId(edge.target);
        if (
          sourceId === undefined ||
          targetId === undefined ||
          isNaN(sourceId) ||
          isNaN(targetId)
        ) {
          return;
        }

        if (previewActions) {
          previewActions.onRemoveDependency(sourceId, targetId);
          return;
        }
        if (!operationContext) {
          return;
        }

        const op: ReversibleOperation = {
          type: "removeDependencyRelation",
          sourceId,
          targetId,
        };
        applyOperation(op, operationContext);
        pushUndo(op);
      });
    },
    [pushUndo, operationContextRef, previewActions, readOnly],
  );

  const { handleNodeDragStart, handleNodeDrag, handleNodeDragStop } = useDragReorder(
    setNodes,
    wiMap,
    handleDragSettled,
    pushUndo,
    handleSprintChange,
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Ctrl/Cmd + scroll → zoom
      const isPinchOrCtrl = e.ctrlKey || e.metaKey;

      if (isPinchOrCtrl) {
        e.preventDefault();
        // Ctrl/Cmd + scroll → zoom
        const { x, y, zoom } = getViewport();
        const newZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, zoom * (1 - e.deltaY * SCROLL_ZOOM_SENSITIVITY)),
        );
        void setViewport({ x, y, zoom: newZoom });
      } else {
        e.preventDefault();
        // Plain scroll → vertical pan, Shift+scroll → horizontal pan
        const { x, y, zoom } = getViewport();
        const panSpeed = 1 / zoom;
        if (e.shiftKey) {
          void setViewport({ x: x - e.deltaY * panSpeed, y, zoom });
        } else {
          void setViewport({ x, y: y - e.deltaY * panSpeed, zoom });
        }
      }
    },
    [getViewport, setViewport],
  );

  const zoomToCenter = useCallback(
    (newZoom: number) => {
      const { x, y, zoom } = getViewport();
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const cx = container.clientWidth / 2;
      const cy = container.clientHeight / 2;
      const scale = newZoom / zoom;
      void setViewport(
        { x: cx - (cx - x) * scale, y: cy - (cy - y) * scale, zoom: newZoom },
        { duration: ZOOM_ANIMATION_DURATION_MS },
      );
    },
    [getViewport, setViewport],
  );

  const handleZoomIn = useCallback(() => {
    const { zoom } = getViewport();
    zoomToCenter(Math.min(MAX_ZOOM, zoom * ZOOM_FACTOR));
  }, [getViewport, zoomToCenter]);

  const handleZoomOut = useCallback(() => {
    const { zoom } = getViewport();
    zoomToCenter(Math.max(MIN_ZOOM, zoom / ZOOM_FACTOR));
  }, [getViewport, zoomToCenter]);

  useKeyDown({ key: "z", modifiers: ["ctrl"] }, undo, { enabled: !readOnly });
  useKeyDown({ key: "y", modifiers: ["ctrl"] }, redo, { enabled: !readOnly });
  useKeyDown(
    [
      { key: "=", modifiers: ["ctrl"] },
      { key: "+", modifiers: ["ctrl"] },
    ],
    handleZoomIn,
  );
  useKeyDown({ key: "-", modifiers: ["ctrl"] }, handleZoomOut);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={readOnly ? undefined : handleNodeDragStart}
        onNodeDrag={readOnly ? undefined : handleNodeDrag}
        onNodeDragStop={readOnly ? undefined : handleNodeDragStop}
        onConnect={readOnly ? undefined : handleConnect}
        onEdgeClick={handleEdgeClick}
        onEdgesDelete={readOnly ? undefined : handleEdgesDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        zoomOnScroll={false}
        panOnScroll={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={BACKGROUND_GRID_GAP}
          size={BACKGROUND_DOT_SIZE}
        />
        {DEBUG_SHOW_OBSTACLES && <DebugObstacles />}
        <Controls showZoom={false} showFitView={false} showInteractive={false}>
          <ControlButton onClick={handleZoomIn} title="Zoom in">
            {"+"}
          </ControlButton>
          <ControlButton onClick={handleZoomOut} title="Zoom out">
            {"−"}
          </ControlButton>
          <ControlButton
            onClick={() => {
              void fitView({ duration: FIT_VIEW_ANIMATION_DURATION_MS });
            }}
            title="Fit view"
          >
            {"⊡"}
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
}
