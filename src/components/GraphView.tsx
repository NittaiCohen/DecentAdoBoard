import { useCallback, useEffect, useMemo, useState } from "react";
import { isNil } from "lodash-es";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BoardData } from "../types";
import WorkItemNodeComponent from "./WorkItemNode";
import SprintDividerComponent from "./SprintDivider";
import ParentGroupComponent from "./ParentGroup";
import { buildGraphLayout } from "../utils/graphLayout";

interface GraphViewProps {
  boardData?: BoardData;
}

const nodeTypes: NodeTypes = {
  workItem: WorkItemNodeComponent,
  sprintDivider: SprintDividerComponent,
  parentGroup: ParentGroupComponent,
};

export default function GraphView({ boardData }: GraphViewProps) {
  const [expandedParents, setExpandedParents] = useState<Set<number>>(() => new Set());

  // Expand all parents by default when board data loads
  useEffect(() => {
    if (!boardData) {
      return;
    }
    const childIds = new Set(
      boardData.work_items
        .filter((workItem) => !isNil(workItem.parent_id))
        .map((workItem) => workItem.parent_id!),
    );
    // Only add new parents (don't reset user collapses)
    setExpandedParents((prev) => {
      const next = new Set(prev);
      for (const id of childIds) {
        next.add(id);
      }
      return next;
    });
  }, [boardData]);

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (!boardData) {
      return { nodes: [], edges: [] };
    }

    const result = buildGraphLayout(boardData, expandedParents);

    // Inject the toggle callback into work item and parent group nodes
    return {
      nodes: result.nodes.map((n) => {
        if (n.type === "workItem" || n.type === "parentGroup") {
          return {
            ...n,
            data: {
              ...n.data,
              onToggleExpand: handleToggleExpand,
            },
          };
        }
        return n;
      }),
      edges: result.edges,
    };
  }, [boardData, expandedParents, handleToggleExpand]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Re-sync when layout changes
  useEffect(() => {
    setNodes(() => layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
