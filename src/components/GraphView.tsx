import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isNil } from "lodash-es";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BoardData, RequiredSome, WorkItem } from "../types";
import WorkItemNodeComponent from "./WorkItemNode";
import SprintDividerComponent from "./SprintDivider";
import ParentGroupComponent from "./ParentGroup";
import DragGhostComponent from "./DragGhost";
import { buildGraphLayout, NODE_HEIGHT, NODE_GAP_Y } from "../utils/graphLayout";

interface GraphViewProps {
  boardData?: BoardData;
}

const nodeTypes: NodeTypes = {
  workItem: WorkItemNodeComponent,
  sprintDivider: SprintDividerComponent,
  parentGroup: ParentGroupComponent,
  dragGhost: DragGhostComponent,
};

const SUB_COLUMN_WIDTH_FALLBACK = 280;
const GHOST_NODE_ID = "__drag-ghost__";
const WORK_ITEM_NODE_PREFIX = "wi-";
const GROUP_NODE_PREFIX = "group-";

/** Extract the numeric work item ID from a node ID */
function extractWorkItemId(nodeId: string): number | undefined {
  if (nodeId.startsWith(WORK_ITEM_NODE_PREFIX)) {
    return Number(nodeId.slice(WORK_ITEM_NODE_PREFIX.length));
  }
  if (nodeId.startsWith(GROUP_NODE_PREFIX)) {
    return Number(nodeId.slice(GROUP_NODE_PREFIX.length));
  }
  return undefined;
}

interface SiblingInfo {
  id: string;
  origY: number;
  height: number;
}

/** Collect all recursive successor node IDs from a starting work item */
function collectSuccessorChain(
  startId: number,
  workItemMap: Map<number, WorkItem>,
  nodeMap: Map<string, Node>,
): Set<string> {
  const result = new Set<string>();
  const queue = [startId];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const id = queue.pop();
    if (isNil(id) || visited.has(id)) {
      continue;
    }
    visited.add(id);

    const workItem = workItemMap.get(id);
    if (!workItem) {
      continue;
    }

    for (const successorId of workItem.successors) {
      // Successor might be a wi- node or a group- node (if expanded parent)
      const wiNodeId = `${WORK_ITEM_NODE_PREFIX}${successorId}`;
      const groupNodeId = `${GROUP_NODE_PREFIX}${successorId}`;
      const successorNodeId = nodeMap.has(groupNodeId) ? groupNodeId : wiNodeId;
      if (!result.has(successorNodeId)) {
        result.add(successorNodeId);
        queue.push(successorId);
      }
    }
  }

  return result;
}

/** Check if a work item has any predecessor in the same column (horizontally overlapping) */
function hasPredecessorInColumn(
  workItem: WorkItem,
  dragX: number,
  dragWidth: number,
  nodeMap: Map<string, Node>,
): boolean {
  for (const predecessorId of workItem.predecessors) {
    const predecessorNode =
      nodeMap.get(`${WORK_ITEM_NODE_PREFIX}${predecessorId}`) ??
      nodeMap.get(`${GROUP_NODE_PREFIX}${predecessorId}`);
    if (!predecessorNode) {
      continue;
    }
    const predecessorWidth = predecessorNode.style?.width
      ? Number(predecessorNode.style.width)
      : SUB_COLUMN_WIDTH_FALLBACK;
    const hasXOverlap =
      dragX < predecessorNode.position.x + predecessorWidth &&
      dragX + dragWidth > predecessorNode.position.x;
    if (hasXOverlap) {
      return true;
    }
  }
  return false;
}

export default function GraphView({ boardData }: GraphViewProps) {
  const [expandedParents, setExpandedParents] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!boardData) {
      return;
    }
    const childIds = new Set(
      boardData.work_items
        .filter(
          (workItem): workItem is RequiredSome<WorkItem, "parent_id"> => !isNil(workItem.parent_id),
        )
        .map((workItem) => workItem.parent_id),
    );
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

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(() => layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  // Work item lookup by numeric ID (avoids casting node data)
  const wiMapRef = useRef<Map<number, WorkItem>>(new Map());
  useEffect(() => {
    const map = new Map<number, WorkItem>();
    if (boardData) {
      for (const wi of boardData.work_items) {
        map.set(wi.id, wi);
      }
    }
    wiMapRef.current = map;
  }, [boardData]);

  // Drag reorder state: ordered list of column siblings + dragged node info
  const dragRef = useRef<{
    draggedId: string;
    draggedParent: string | undefined;
    draggedOrigX: number;
    draggedOrigY: number;
    columnX: number;
    draggedHeight: number;
    draggedWidth: number;
    siblings: SiblingInfo[];
    baseY: number;
    successorIds: Set<string>;
    successorOriginalX: Map<string, number>;
    xLocked: boolean;
    lastInsertIdx: number;
    lastSlotPositions: Map<string, number>;
  } | null>(null);
  const rafRef = useRef(0);

  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      setNodes((prev) => {
        const dragHeight =
          draggedNode.measured?.height ??
          (draggedNode.style?.height ? Number(draggedNode.style.height) : NODE_HEIGHT);
        const dragWidth =
          draggedNode.measured?.width ??
          (draggedNode.style?.width ? Number(draggedNode.style.width) : SUB_COLUMN_WIDTH_FALLBACK);
        const dragX = draggedNode.position.x;
        const dragParent = draggedNode.parentId;

        // Build node map for lookups
        const nodeMap = new Map<string, Node>();
        for (const node of prev) {
          nodeMap.set(node.id, node);
        }

        // Extract work item ID from node ID (format: wi-{id} or group-{id})
        const workItemId = extractWorkItemId(draggedNode.id);
        const draggedWorkItem = isNil(workItemId) ? undefined : wiMapRef.current.get(workItemId);

        // Determine if X is locked (has predecessor in same column)
        const xLocked = draggedWorkItem
          ? hasPredecessorInColumn(draggedWorkItem, dragX, dragWidth, nodeMap)
          : true;

        // Collect recursive successor chain and snapshot their X positions
        const successorIds = draggedWorkItem
          ? collectSuccessorChain(draggedWorkItem.id, wiMapRef.current, nodeMap)
          : new Set<string>();
        const successorOriginalX = new Map<string, number>();
        for (const successorId of successorIds) {
          const successorNode = nodeMap.get(successorId);
          if (successorNode) {
            successorOriginalX.set(successorId, successorNode.position.x);
          }
        }

        // Collect siblings: same parent, draggable, in the same vertical column
        // First pass: find all candidates with same parent
        const candidates: Array<{ id: string; x: number; origY: number; height: number }> = [];
        for (const node of prev) {
          if (node.id === draggedNode.id || !node.draggable || node.parentId !== dragParent) {
            continue;
          }
          candidates.push({
            id: node.id,
            x: node.position.x,
            origY: node.position.y,
            height: node.style?.height ? Number(node.style.height) : NODE_HEIGHT,
          });
        }
        // Filter to items that share an X column with each other (clustered near same X)
        const columnThreshold = SUB_COLUMN_WIDTH_FALLBACK;
        // Find the column with the most candidates (the "home" column)
        let targetColumnX = dragX;
        if (candidates.length > 0) {
          // Group candidates by X proximity and find the largest group
          const columns: Array<{ x: number; count: number }> = [];
          for (const candidate of candidates) {
            const existingColumn = columns.find(
              (col) => Math.abs(col.x - candidate.x) < columnThreshold,
            );
            if (existingColumn) {
              existingColumn.count++;
            } else {
              columns.push({ x: candidate.x, count: 1 });
            }
          }
          // Use the column with the most items
          const largestColumn = columns.reduce((largest, col) =>
            col.count > largest.count ? col : largest,
          );
          targetColumnX = largestColumn.x;
        }
        const siblings: SiblingInfo[] = candidates
          .filter((c) => Math.abs(c.x - targetColumnX) < columnThreshold)
          .map(({ id, origY, height }) => ({ id, origY, height }));
        siblings.sort((a, b) => a.origY - b.origY);

        const allYs = [draggedNode.position.y, ...siblings.map((s) => s.origY)];
        const baseY = Math.min(...allYs);

        dragRef.current = {
          draggedId: draggedNode.id,
          draggedParent: dragParent,
          draggedOrigX: dragX,
          draggedOrigY: draggedNode.position.y,
          columnX: targetColumnX,
          draggedHeight: dragHeight,
          draggedWidth: dragWidth,
          siblings,
          baseY,
          successorIds,
          successorOriginalX,
          xLocked,
          lastInsertIdx: -1,
          lastSlotPositions: new Map(),
        };

        // Ghost at dragged node's original position initially
        const ghostNode = {
          id: GHOST_NODE_ID,
          type: "dragGhost",
          position: { ...draggedNode.position },
          parentId: dragParent,
          data: { width: dragWidth, height: dragHeight },
          draggable: false,
          selectable: false,
          focusable: false,
          className: "transition-[transform] duration-200 ease-out",
        };

        return [
          ...prev.map((node) => {
            if (siblings.some((s) => s.id === node.id) || successorIds.has(node.id)) {
              return { ...node, className: "transition-[transform] duration-200 ease-out" };
            }
            return node;
          }),
          ghostNode,
        ];
      });
    },
    [setNodes],
  );

  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const state = dragRef.current;
        if (!state) {
          return;
        }

        // Check if dragged node is still horizontally in the sibling column
        const xDrift = Math.abs(draggedNode.position.x - state.columnX);
        const inOriginalColumn = xDrift < SUB_COLUMN_WIDTH_FALLBACK;

        // Reset slot state when leaving column so re-entry triggers a fresh scan
        if (!inOriginalColumn && state.lastInsertIdx >= 0) {
          state.lastInsertIdx = -1;
          state.lastSlotPositions = new Map();
        }

        // Only compute slot reorder if still in the original column
        const slotPositions = new Map<string, number>();
        let ghostY = draggedNode.position.y;

        if (inOriginalColumn) {
          // Use current slot positions for midpoint comparison,
          // falling back to original positions on first drag event
          const currentPositions = state.lastSlotPositions;

          // Consistent rule using leading edge vs sibling center:
          // - Move UP: dragged TOP < sibling CENTER (works for tall items)
          // - Move DOWN: dragged BOTTOM > sibling CENTER (works for tall items)
          // Both require crossing the same relative threshold (half sibling height + gap)
          const dragTop = draggedNode.position.y;
          const dragBottom = dragTop + state.draggedHeight;

          // Start from last known position, then expand up/down
          let insertIdx = state.lastInsertIdx >= 0 ? state.lastInsertIdx : state.siblings.length;

          if (state.lastInsertIdx < 0) {
            // First frame: scan to find initial position using center for stability
            const dragCenterY = dragTop + state.draggedHeight / 2;
            insertIdx = state.siblings.length;
            for (let i = 0; i < state.siblings.length; i++) {
              const sibling = state.siblings[i];
              const sibY = currentPositions.get(sibling.id) ?? sibling.origY;
              const sibCenterY = sibY + sibling.height / 2;
              if (dragCenterY < sibCenterY) {
                insertIdx = i;
                break;
              }
            }
          } else {
            const prevInsertIdx = insertIdx;
            // Move UP: trigger when dragged item overlaps more than half of the sibling above
            while (insertIdx > 0) {
              const sibling = state.siblings[insertIdx - 1];
              const sibY = currentPositions.get(sibling.id) ?? sibling.origY;
              const sibBottom = sibY + sibling.height;
              // Overlap amount between dragged item and the sibling above
              const overlapTop = Math.max(0, sibBottom - dragTop);
              if (overlapTop > sibling.height / 2) {
                insertIdx--;
              } else {
                break;
              }
            }
            // Only check DOWN if UP didn't move (prevent UP/DOWN fighting)
            if (insertIdx === prevInsertIdx) {
              // Move DOWN: trigger when dragged item overlaps more than half of the sibling below
              while (insertIdx < state.siblings.length) {
                const sibling = state.siblings[insertIdx];
                const sibY = currentPositions.get(sibling.id) ?? sibling.origY;
                // Overlap amount between dragged item and the sibling below
                const overlapBottom = Math.max(0, dragBottom - sibY);
                if (overlapBottom > sibling.height / 2) {
                  insertIdx++;
                } else {
                  break;
                }
              }
            }
          }

          // Build slot positions: stack all items (siblings + dragged placeholder)
          let currentY = state.baseY;
          for (let i = 0; i <= state.siblings.length; i++) {
            if (i === insertIdx) {
              ghostY = currentY;
              currentY += state.draggedHeight + NODE_GAP_Y;
            }
            if (i < state.siblings.length) {
              const sibling = state.siblings[i];
              slotPositions.set(sibling.id, currentY);
              currentY += sibling.height + NODE_GAP_Y;
            }
          }

          // Save current slot positions for next comparison
          state.lastInsertIdx = insertIdx;
          state.lastSlotPositions = slotPositions;
        }

        // Compute X delta for successors
        const deltaX = state.xLocked ? 0 : draggedNode.position.x - state.draggedOrigX;

        setNodes((prev) =>
          prev.map((node) => {
            if (node.id === GHOST_NODE_ID) {
              const ghostX = state.xLocked ? state.draggedOrigX : draggedNode.position.x;
              return { ...node, position: { x: ghostX, y: ghostY } };
            }
            if (node.id === state.draggedId) {
              return node;
            }
            // Move successors by same X delta
            const successorOrigX = state.successorOriginalX.get(node.id);
            if (!isNil(successorOrigX) && deltaX !== 0) {
              return { ...node, position: { x: successorOrigX + deltaX, y: node.position.y } };
            }
            // Reposition column siblings to their computed Y slots (or restore if left column)
            const siblingInfo = state.siblings.find((s) => s.id === node.id);
            if (siblingInfo) {
              const slotY = slotPositions.get(node.id);
              const targetY = slotY ?? siblingInfo.origY;
              return { ...node, position: { x: node.position.x, y: targetY } };
            }
            return node;
          }),
        );
      });
    },
    [setNodes],
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      cancelAnimationFrame(rafRef.current);
      const state = dragRef.current;

      if (!state) {
        setNodes((prev) =>
          prev
            .filter((node) => node.id !== GHOST_NODE_ID)
            .map((node) => (node.className ? { ...node, className: undefined } : node)),
        );
        dragRef.current = null;
        return;
      }

      // Check if dragged node is still in sibling column
      const xDrift = Math.abs(draggedNode.position.x - state.columnX);
      const inOriginalColumn = xDrift < SUB_COLUMN_WIDTH_FALLBACK;

      // Compute final slot positions (only if still in original column)
      const slotPositions = new Map<string, number>();
      let ghostY = draggedNode.position.y;

      if (inOriginalColumn) {
        // Use the last computed insert index from the drag handler
        const insertIdx = state.lastInsertIdx >= 0 ? state.lastInsertIdx : state.siblings.length;

        let currentY = state.baseY;
        for (let i = 0; i <= state.siblings.length; i++) {
          if (i === insertIdx) {
            ghostY = currentY;
            currentY += state.draggedHeight + NODE_GAP_Y;
          }
          if (i < state.siblings.length) {
            const sibling = state.siblings[i];
            slotPositions.set(sibling.id, currentY);
            currentY += sibling.height + NODE_GAP_Y;
          }
        }
      }

      const finalX = state.xLocked ? state.draggedOrigX : draggedNode.position.x;
      const deltaX = state.xLocked ? 0 : draggedNode.position.x - state.draggedOrigX;

      // Finalize: place dragged node at ghost slot, siblings at their computed slots,
      // successors keep their shifted X
      setNodes((prev) =>
        prev
          .filter((node) => node.id !== GHOST_NODE_ID)
          .map((node) => {
            if (node.id === state.draggedId) {
              return {
                ...node,
                position: { x: finalX, y: ghostY },
                className: undefined,
              };
            }
            // Finalize successor X positions
            const successorOrigX = state.successorOriginalX.get(node.id);
            if (!isNil(successorOrigX) && deltaX !== 0) {
              return {
                ...node,
                position: { x: successorOrigX + deltaX, y: node.position.y },
                className: undefined,
              };
            }
            // Restore siblings: to slot if in column, to original if dragged out
            const siblingInfo = state.siblings.find((s) => s.id === node.id);
            if (siblingInfo) {
              const slotY = slotPositions.get(node.id);
              const targetY = slotY ?? siblingInfo.origY;
              return {
                ...node,
                position: { x: node.position.x, y: targetY },
                className: undefined,
              };
            }
            return node.className ? { ...node, className: undefined } : node;
          }),
      );

      dragRef.current = null;
    },
    [setNodes],
  );

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="w-full h-full">
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
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
