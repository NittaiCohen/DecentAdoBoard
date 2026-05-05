import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BoardData, WorkItem } from "../types";
import WorkItemNodeComponent from "./WorkItemNode";
import SprintDividerComponent from "./SprintDivider";
import ParentGroupComponent from "./ParentGroup";
import DragGhostComponent from "./DragGhost";
import { buildGraphLayout } from "../utils/graphLayout";
import { useDragReorder } from "../hooks/useDragReorder";
import { useExpandedParents } from "../hooks/useExpandedParents";

interface GraphViewProps {
  boardData?: BoardData;
}

const nodeTypes: NodeTypes = {
  workItem: WorkItemNodeComponent,
  sprintDivider: SprintDividerComponent,
  parentGroup: ParentGroupComponent,
  dragGhost: DragGhostComponent,
};

export default function GraphView({ boardData }: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner boardData={boardData} />
    </ReactFlowProvider>
  );
}

const ZOOM_DURATION_MS = 100;

function GraphViewInner({ boardData }: GraphViewProps) {
  const [expandedParents, handleToggleExpand] = useExpandedParents(boardData);
  const { zoomIn, zoomOut, setViewport, getViewport } = useReactFlow();

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

  const wiMapRef = useRef<Map<number, WorkItem>>(new Map());
  useEffect(() => {
    const map = new Map<number, WorkItem>();
    if (boardData) {
      for (const workItem of boardData.work_items) {
        map.set(workItem.id, workItem);
      }
    }
    wiMapRef.current = map;
  }, [boardData]);

  const { handleNodeDragStart, handleNodeDrag, handleNodeDragStop } = useDragReorder(
    setNodes,
    wiMapRef,
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + scroll → zoom
        if (e.deltaY < 0) {
          void zoomIn({ duration: ZOOM_DURATION_MS });
        } else {
          void zoomOut({ duration: ZOOM_DURATION_MS });
        }
      } else {
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
    [zoomIn, zoomOut, getViewport, setViewport],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        zoomOnScroll={false}
        panOnScroll={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
