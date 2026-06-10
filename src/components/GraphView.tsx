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
import { buildGraphLayout, buildNodePositions } from "../utils/graphLayout";
import { assignLaneOffsets } from "../utils/edgeRouting";
import { wouldCreateCycle } from "../utils/dependencies";
import { useDragReorder } from "../hooks/useDragReorder";
import { useExpandedParents } from "../hooks/useExpandedParents";
import type { OperationContext, ReversibleOperation } from "../utils/reversibleOperations";
import { applyOperation } from "../utils/reversibleOperations";

interface GraphViewProps {
  boardData?: BoardData;
  operationContextRef: React.RefObject<OperationContext | null>;
  pushUndo: (op: ReversibleOperation) => void;
  undo: () => void;
  redo: () => void;
}

const nodeTypes: NodeTypes = {
  workItem: WorkItemNodeComponent,
  sprintDivider: SprintDividerComponent,
  parentGroup: ParentGroupComponent,
  dragGhost: DragGhostComponent,
};

const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge,
};

export default function GraphView({
  boardData,
  operationContextRef,
  pushUndo,
  undo,
  redo,
}: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner
        boardData={boardData}
        operationContextRef={operationContextRef}
        pushUndo={pushUndo}
        undo={undo}
        redo={redo}
      />
    </ReactFlowProvider>
  );
}

const SCROLL_ZOOM_SENSITIVITY = 0.01;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const ZOOM_FACTOR = 1.25;

function GraphViewInner({ boardData, operationContextRef, pushUndo, undo, redo }: GraphViewProps) {
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
        if (n.type === "workItem" || n.type === "parentGroup") {
          return { ...n, data: { ...n.data, onToggleExpand: handleToggleExpand } };
        }
        return n;
      }),
      edges: result.edges,
    };
  }, [boardData, expandedParents, handleToggleExpand]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(() => layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const handleDragSettled = useCallback(
    (finalNodes: Node[]) => {
      const nodePositions = buildNodePositions(finalNodes);
      setEdges((prev) => assignLaneOffsets(prev, nodePositions));
    },
    [setEdges],
  );

  useEffect(() => {
    operationContextRef.current = { queryClient, setNodes, onDragSettled: handleDragSettled };
  });

  const handleConnect = useCallback(
    (connection: Connection) => {
      const sourceId = parseInt(connection.source.replace("wi-", ""), 10);
      const targetId = parseInt(connection.target.replace("wi-", ""), 10);
      if (isNaN(sourceId) || isNaN(targetId)) {
        return;
      }

      if (wouldCreateCycle(sourceId, targetId, wiMap)) {
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
    [wiMap, pushUndo, operationContextRef],
  );

  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      const ctx = operationContextRef.current;
      if (!ctx) {
        return;
      }
      deletedEdges.forEach((edge) => {
        const match = /^edge-(\d+)-(\d+)$/.exec(edge.id);
        if (!match) {
          return;
        }
        const sourceWiId = parseInt(match[1], 10);
        const targetWiId = parseInt(match[2], 10);

        const op: ReversibleOperation = {
          type: "removeDependencyRelation",
          sourceId: sourceWiId,
          targetId: targetWiId,
        };
        applyOperation(op, ctx);
        pushUndo(op);
      });
    },
    [pushUndo, operationContextRef],
  );

  const { handleNodeDragStart, handleNodeDrag, handleNodeDragStop } = useDragReorder(
    setNodes,
    wiMap,
    handleDragSettled,
    pushUndo,
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
        { duration: 150 },
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

  useKeyDown({ key: "z", modifiers: ["ctrl"] }, undo);
  useKeyDown({ key: "y", modifiers: ["ctrl"] }, redo);
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
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        zoomOnScroll={false}
        panOnScroll={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showZoom={false} showFitView={false} showInteractive={false}>
          <ControlButton onClick={handleZoomIn} title="Zoom in">
            {"+"}
          </ControlButton>
          <ControlButton onClick={handleZoomOut} title="Zoom out">
            {"−"}
          </ControlButton>
          <ControlButton
            onClick={() => {
              void fitView({ duration: 300 });
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
