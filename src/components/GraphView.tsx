import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useKeyDown } from "../hooks/useKeyDown";
import {
  Background,
  BackgroundVariant,
  type Connection,
  ControlButton,
  Controls,
  type Edge,
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
import { buildGraphLayout, buildNodePositions } from "../utils/graphLayout";
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
const DEBUG_SHOW_OBSTACLES = false;

export default function GraphView({
  boardData,
  operationContextRef,
  pushUndo = NO_OP_OPERATION,
  undo = NO_OP,
  redo = NO_OP,
  readOnly = false,
  previewActions,
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
      nodes: result.nodes.map((n) => {
        if (n.type === BOARD_NODE_TYPES.workItem || n.type === BOARD_NODE_TYPES.parentGroup) {
          return {
            ...n,
            data: {
              ...n.data,
              onToggleExpand: handleToggleExpand,
              previewMode: previewActions !== undefined,
              onPreviewStateChange: previewActions?.onStateChange,
            },
          };
        }
        return n;
      }),
      edges: result.edges,
    };
  }, [boardData, expandedParents, handleToggleExpand, previewActions]);

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
    const allMeasured = nodes.length > 0 && nodes.every((n) => n.measured?.width !== undefined);
    if (!allMeasured) {
      return;
    }
    routedLayoutRef.current = layoutNodes;
    const { positions: nodePositions, parentMap } = buildNodePositions(nodes);
    setEdges((prev) => assignLaneOffsets(prev, nodePositions, parentMap));
  }, [nodes, layoutNodes, setEdges]);

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
