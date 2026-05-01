import type { Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { BoardData, WorkItem } from "../types";
import type { WorkItemNodeData } from "../components/WorkItemNode";
import type { SprintDividerData } from "../components/SprintDivider";
import type { ParentGroupData } from "../components/ParentGroup";

const NODE_HEIGHT = 80;
const NODE_GAP_X = 60;
const NODE_GAP_Y = 20;
const SPRINT_PADDING = 40;
const MIN_COLUMN_WIDTH = 1200;
const TOP_OFFSET = 60;

type AnyNodeData = WorkItemNodeData | SprintDividerData | ParentGroupData;

interface LayoutNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: AnyNodeData;
  parentId?: string;
  extent?: "parent";
  draggable?: boolean;
  style?: Record<string, unknown>;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: Edge[];
}

const GROUP_PADDING = 20;
const CHILD_WIDTH = 220;
const HEADER_HEIGHT = 36;
const MULTI_SPRINT_TYPES = new Set(["Epic", "Feature"]);
const MULTI_SPRINT_LANE_GAP = 40;

// Track which work item ID maps to which rendered node ID
type NodeIdMap = Map<number, string>;

/**
 * Collect all descendant leaf iteration paths for a work item.
 */
function collectDescendantIterPaths(
  wi: WorkItem,
  workItemMap: Map<number, WorkItem>
): Set<string> {
  const paths = new Set<string>();
  const children = wi.children
    .map((cid) => workItemMap.get(cid))
    .filter((c): c is WorkItem => c !== undefined);

  if (children.length === 0) {
    // Leaf node — use own path
    paths.add(wi.iteration_path);
    return paths;
  }

  for (const child of children) {
    for (const p of collectDescendantIterPaths(child, workItemMap)) {
      paths.add(p);
    }
  }
  return paths;
}

/**
 * Measure the height a work item will occupy inside a group,
 * accounting for recursive expansion.
 */
function measureChildHeight(
  wi: WorkItem,
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>
): { height: number; width: number } {
  const isParent = wi.children.length > 0;
  const isExpanded = expandedParents.has(wi.id);

  if (!isParent || !isExpanded) {
    return { height: NODE_HEIGHT, width: CHILD_WIDTH };
  }

  const childItems = wi.children
    .map((cid) => workItemMap.get(cid))
    .filter((c): c is WorkItem => c !== undefined);

  let innerHeight = 0;
  let innerMaxWidth = CHILD_WIDTH;
  for (const child of childItems) {
    const m = measureChildHeight(child, workItemMap, expandedParents, doneStates);
    innerHeight += m.height + NODE_GAP_Y;
    innerMaxWidth = Math.max(innerMaxWidth, m.width);
  }
  innerHeight -= NODE_GAP_Y;

  const groupWidth = innerMaxWidth + GROUP_PADDING * 2;
  const groupHeight = HEADER_HEIGHT + GROUP_PADDING * 2 + innerHeight;
  return { height: groupHeight, width: groupWidth };
}

/**
 * Recursively render an expanded parent group and its children (single-column).
 * Returns the group dimensions.
 */
function renderExpandedGroup(
  wi: WorkItem,
  x: number,
  y: number,
  reactFlowParentId: string | undefined,
  nodes: LayoutNode[],
  nodeIdMap: NodeIdMap,
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>
): { width: number; height: number } {
  const childItems = wi.children
    .map((cid) => workItemMap.get(cid))
    .filter((c): c is WorkItem => c !== undefined);

  let childAreaHeight = 0;
  let childMaxWidth = CHILD_WIDTH;
  for (const child of childItems) {
    const m = measureChildHeight(child, workItemMap, expandedParents, doneStates);
    childAreaHeight += m.height + NODE_GAP_Y;
    childMaxWidth = Math.max(childMaxWidth, m.width);
  }
  childAreaHeight -= NODE_GAP_Y;

  const groupWidth = childMaxWidth + GROUP_PADDING * 2;
  const groupHeight = HEADER_HEIGHT + GROUP_PADDING * 2 + childAreaHeight;

  const doneChildCount = wi.children.filter((cid) => {
    const c = workItemMap.get(cid);
    return c && doneStates.has(c.state);
  }).length;

  const groupId = `group-${wi.id}`;
  nodeIdMap.set(wi.id, groupId);

  const node: LayoutNode = {
    id: groupId,
    type: "parentGroup",
    position: { x, y },
    data: {
      label: wi.title,
      workItemId: wi.id,
      workItemType: wi.work_item_type,
      state: wi.state,
      childCount: wi.children.length,
      doneChildCount,
      width: groupWidth,
      height: groupHeight,
      onToggleExpand: undefined,
    },
    draggable: true,
    style: { width: groupWidth, height: groupHeight },
  };
  if (reactFlowParentId) {
    node.parentId = reactFlowParentId;
    node.extent = "parent";
  }
  nodes.push(node);

  let childY = HEADER_HEIGHT + GROUP_PADDING;
  for (const child of childItems) {
    const childIsParent = child.children.length > 0;
    const childIsExpanded = expandedParents.has(child.id);

    if (childIsParent && childIsExpanded) {
      const dims = renderExpandedGroup(
        child,
        GROUP_PADDING,
        childY,
        groupId,
        nodes,
        nodeIdMap,
        workItemMap,
        expandedParents,
        doneStates
      );
      childY += dims.height + NODE_GAP_Y;
    } else {
      const childDoneCount = child.children.filter((cid) => {
        const c = workItemMap.get(cid);
        return c && doneStates.has(c.state);
      }).length;

      const childNodeId = `wi-${child.id}`;
      nodeIdMap.set(child.id, childNodeId);

      nodes.push({
        id: childNodeId,
        type: "workItem",
        position: { x: GROUP_PADDING, y: childY },
        parentId: groupId,
        extent: "parent",
        data: {
          workItem: child,
          isParent: childIsParent,
          isExpanded: false,
          childCount: child.children.length,
          doneChildCount: childDoneCount,
        },
        draggable: true,
      });
      childY += NODE_HEIGHT + NODE_GAP_Y;
    }
  }

  return { width: groupWidth, height: groupHeight };
}

interface ColumnInfo {
  startX: number;
  width: number;
  maxY: number;
}

export function buildGraphLayout(
  boardData: BoardData,
  expandedParents: Set<number>
): LayoutResult {
  const { work_items, iterations } = boardData;
  const nodes: LayoutNode[] = [];
  const edges: Edge[] = [];
  const nodeIdMap: NodeIdMap = new Map();

  if (work_items.length === 0) {
    return { nodes, edges };
  }

  const workItemMap = new Map(work_items.map((wi) => [wi.id, wi]));
  const doneStates = new Set(["Done", "Closed", "Resolved", "Removed"]);

  const iterationByPath = new Map(
    iterations.map((it) => [it.path, it])
  );

  // --- Phase 1: Identify multi-sprint parents ---
  const multiSprintParentIds = new Set<number>();
  const multiSprintDescendantIds = new Set<number>();

  function markDescendants(id: number) {
    multiSprintDescendantIds.add(id);
    const wi = workItemMap.get(id);
    if (wi) {
      for (const cid of wi.children) {
        markDescendants(cid);
      }
    }
  }

  // Only consider top-level items (no parent in workItemMap) of Epic/Feature type
  for (const wi of work_items) {
    if (wi.parent_id && workItemMap.has(wi.parent_id)) continue;
    if (!MULTI_SPRINT_TYPES.has(wi.work_item_type)) continue;
    if (wi.children.length === 0) continue;

    const descendantPaths = collectDescendantIterPaths(wi, workItemMap);
    if (descendantPaths.size >= 2) {
      multiSprintParentIds.add(wi.id);
      for (const cid of wi.children) {
        markDescendants(cid);
      }
    }
  }

  // --- Phase 2: Collect all iteration paths ---
  const allIterPaths = new Set<string>();
  for (const wi of work_items) {
    allIterPaths.add(wi.iteration_path);
  }

  // Group regular (non-multi-sprint) top-level items by iteration path
  const iterationGroups = new Map<string, WorkItem[]>();
  for (const wi of work_items) {
    if (wi.parent_id && workItemMap.has(wi.parent_id)) continue;
    if (multiSprintParentIds.has(wi.id)) continue;
    if (multiSprintDescendantIds.has(wi.id)) continue;

    const group = iterationGroups.get(wi.iteration_path) ?? [];
    group.push(wi);
    iterationGroups.set(wi.iteration_path, group);
  }

  // Sort all iteration paths by date
  const iterationPaths = [...allIterPaths].sort((a, b) => {
    const iterA = iterationByPath.get(a);
    const iterB = iterationByPath.get(b);
    if (iterA?.start_date && iterB?.start_date) {
      return iterA.start_date.localeCompare(iterB.start_date);
    }
    return a.localeCompare(b);
  });

  // Determine current sprint by date
  const now = new Date().toISOString();
  let currentIterPath: string | null = null;
  for (const [path, iter] of iterationByPath) {
    if (iter.start_date && iter.finish_date && iter.start_date <= now && now <= iter.finish_date) {
      currentIterPath = path;
      break;
    }
  }

  // --- Phase 3: Layout regular items in sprint columns ---
  const columnInfoMap = new Map<string, ColumnInfo>();
  let currentX = SPRINT_PADDING;

  for (const iterPath of iterationPaths) {
    const columnStartX = currentX;
    let maxColumnWidth = MIN_COLUMN_WIDTH;

    const items = iterationGroups.get(iterPath) ?? [];

    const sortedItems = [...items].sort((a, b) => {
      const aDone = doneStates.has(a.state) ? 1 : 0;
      const bDone = doneStates.has(b.state) ? 1 : 0;
      return aDone - bDone;
    });

    let currentY = TOP_OFFSET;
    for (const wi of sortedItems) {
      const isParent = wi.children.length > 0;
      const isExpanded = expandedParents.has(wi.id);
      const doneChildCount = wi.children.filter((cid) => {
        const child = workItemMap.get(cid);
        return child && doneStates.has(child.state);
      }).length;

      if (isParent && isExpanded) {
        const { width: groupWidth, height: groupHeight } = renderExpandedGroup(
          wi,
          columnStartX,
          currentY,
          undefined,
          nodes,
          nodeIdMap,
          workItemMap,
          expandedParents,
          doneStates
        );
        maxColumnWidth = Math.max(maxColumnWidth, groupWidth);
        currentY += groupHeight + NODE_GAP_Y;
      } else {
        const nodeId = `wi-${wi.id}`;
        nodeIdMap.set(wi.id, nodeId);
        nodes.push({
          id: nodeId,
          type: "workItem",
          position: { x: columnStartX, y: currentY },
          data: {
            workItem: wi,
            isParent,
            isExpanded: false,
            childCount: wi.children.length,
            doneChildCount,
          },
          draggable: true,
        });
        currentY += NODE_HEIGHT + NODE_GAP_Y;
      }
    }

    columnInfoMap.set(iterPath, {
      startX: columnStartX,
      width: maxColumnWidth,
      maxY: currentY,
    });

    currentX += maxColumnWidth + NODE_GAP_X;
  }

  // --- Phase 4: Render multi-sprint parents in cross-sprint lane ---
  // Find the max Y across all columns for the lane start
  let laneStartY = TOP_OFFSET;
  for (const col of columnInfoMap.values()) {
    laneStartY = Math.max(laneStartY, col.maxY);
  }
  laneStartY += MULTI_SPRINT_LANE_GAP;

  let multiSprintY = laneStartY;

  for (const wi of work_items) {
    if (!multiSprintParentIds.has(wi.id)) continue;

    const descendantPaths = collectDescendantIterPaths(wi, workItemMap);
    // Find the column range this parent spans
    const spannedColumns: ColumnInfo[] = [];
    let minX = Infinity;
    let maxEndX = -Infinity;
    for (const path of descendantPaths) {
      const col = columnInfoMap.get(path);
      if (col) {
        spannedColumns.push(col);
        minX = Math.min(minX, col.startX);
        maxEndX = Math.max(maxEndX, col.startX + col.width);
      }
    }
    if (spannedColumns.length === 0) continue;

    // Group immediate children by their iteration path
    const childrenByIter = new Map<string, WorkItem[]>();
    const directChildren = wi.children
      .map((cid) => workItemMap.get(cid))
      .filter((c): c is WorkItem => c !== undefined);

    for (const child of directChildren) {
      // For children that are themselves parents, use their own descendant paths
      // to determine which column to place them in. Use the earliest.
      let placementPath = child.iteration_path;
      if (child.children.length > 0) {
        const childDescPaths = collectDescendantIterPaths(child, workItemMap);
        // Pick the earliest sprint the child's descendants are in
        let earliest: string | null = null;
        let earliestDate: string | null = null;
        for (const p of childDescPaths) {
          const iter = iterationByPath.get(p);
          const date = iter?.start_date ?? p;
          if (!earliest || date < (earliestDate ?? "")) {
            earliest = p;
            earliestDate = date;
          }
        }
        if (earliest) placementPath = earliest;
      }
      const group = childrenByIter.get(placementPath) ?? [];
      group.push(child);
      childrenByIter.set(placementPath, group);
    }

    // Measure content height per column slot
    let maxSlotHeight = 0;
    const slotHeights = new Map<string, number>();
    for (const [iterPath, children] of childrenByIter) {
      let h = 0;
      for (const child of children) {
        const m = measureChildHeight(child, workItemMap, expandedParents, doneStates);
        h += m.height + NODE_GAP_Y;
      }
      h -= NODE_GAP_Y;
      slotHeights.set(iterPath, h);
      maxSlotHeight = Math.max(maxSlotHeight, h);
    }

    const groupWidth = maxEndX - minX + GROUP_PADDING * 2;
    const groupHeight = HEADER_HEIGHT + GROUP_PADDING * 2 + maxSlotHeight;

    const doneChildCount = wi.children.filter((cid) => {
      const c = workItemMap.get(cid);
      return c && doneStates.has(c.state);
    }).length;

    const groupId = `group-${wi.id}`;
    nodeIdMap.set(wi.id, groupId);

    nodes.push({
      id: groupId,
      type: "parentGroup",
      position: { x: minX - GROUP_PADDING, y: multiSprintY },
      data: {
        label: wi.title,
        workItemId: wi.id,
        workItemType: wi.work_item_type,
        state: wi.state,
        childCount: wi.children.length,
        doneChildCount,
        width: groupWidth,
        height: groupHeight,
        onToggleExpand: undefined,
      },
      draggable: true,
      style: { width: groupWidth, height: groupHeight },
    });

    // Render children in their respective column positions
    for (const [iterPath, children] of childrenByIter) {
      const col = columnInfoMap.get(iterPath);
      if (!col) continue;

      // x relative to the group's left edge
      const slotX = col.startX - minX + GROUP_PADDING;
      let childY = HEADER_HEIGHT + GROUP_PADDING;

      for (const child of children) {
        const childIsParent = child.children.length > 0;
        const childIsExpanded = expandedParents.has(child.id);

        if (childIsParent && childIsExpanded) {
          const dims = renderExpandedGroup(
            child,
            slotX,
            childY,
            groupId,
            nodes,
            nodeIdMap,
            workItemMap,
            expandedParents,
            doneStates
          );
          childY += dims.height + NODE_GAP_Y;
        } else {
          const childDoneCount = child.children.filter((cid) => {
            const c = workItemMap.get(cid);
            return c && doneStates.has(c.state);
          }).length;

          const childNodeId = `wi-${child.id}`;
          nodeIdMap.set(child.id, childNodeId);

          nodes.push({
            id: childNodeId,
            type: "workItem",
            position: { x: slotX, y: childY },
            parentId: groupId,
            extent: "parent",
            data: {
              workItem: child,
              isParent: childIsParent,
              isExpanded: false,
              childCount: child.children.length,
              doneChildCount: childDoneCount,
            },
            draggable: true,
          });
          childY += NODE_HEIGHT + NODE_GAP_Y;
        }
      }
    }

    multiSprintY += groupHeight + NODE_GAP_Y;
  }

  // --- Phase 5: Create sprint dividers (final pass for correct heights) ---
  const overallMaxY = Math.max(multiSprintY, laneStartY);
  for (const iterPath of iterationPaths) {
    const col = columnInfoMap.get(iterPath);
    if (!col) continue;

    const iterName = iterPath.split("\\").pop() ?? iterPath;
    const iterInfo = iterationByPath.get(iterPath);
    const dividerHeight = Math.max(overallMaxY + SPRINT_PADDING, TOP_OFFSET + NODE_HEIGHT * 3);
    const isCurrent = iterPath === currentIterPath;

    nodes.push({
      id: `sprint-${iterPath}`,
      type: "sprintDivider",
      position: { x: col.startX - SPRINT_PADDING / 2, y: 0 },
      data: {
        label: iterName,
        startDate: iterInfo?.start_date ?? null,
        finishDate: iterInfo?.finish_date ?? null,
        height: dividerHeight,
        width: col.width + SPRINT_PADDING,
        isCurrent,
      },
      draggable: false,
      style: { zIndex: -1 },
    });
  }

  // --- Build edges using rendered node IDs ---
  for (const wi of work_items) {
    for (const succId of wi.successors) {
      if (workItemMap.has(succId)) {
        const sourceId = nodeIdMap.get(wi.id) ?? `wi-${wi.id}`;
        const targetId = nodeIdMap.get(succId) ?? `wi-${succId}`;
        edges.push({
          id: `edge-${wi.id}-${succId}`,
          source: sourceId,
          target: targetId,
          type: "smoothstep",
          animated: false,
          style: { stroke: "#6b7280", strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
        });
      }
    }
  }

  return { nodes, edges };
}
