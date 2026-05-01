import type { Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { isNil } from "lodash-es";
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
const COLUMN_STRIDE = MIN_COLUMN_WIDTH + NODE_GAP_X;

type AnyNodeData = WorkItemNodeData | SprintDividerData | ParentGroupData;

type CoordExtent = [[number, number], [number, number]];

interface LayoutNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: AnyNodeData;
  parentId?: string;
  extent?: "parent" | CoordExtent;
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

type NodeIdMap = Map<number, string>;

/**
 * Collect all descendant leaf iteration paths for a work item.
 */
function collectDescendantIterPaths(
  workItem: WorkItem,
  workItemMap: Map<number, WorkItem>,
): Set<string> {
  const paths = new Set<string>();
  const children = workItem.children
    .map((childId) => workItemMap.get(childId))
    .filter((childWorkItem): childWorkItem is WorkItem => childWorkItem !== undefined);

  if (children.length === 0) {
    paths.add(workItem.iteration_path);
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
 * Measure the height a work item will occupy inside a group.
 */
function measureChildHeight(
  workItem: WorkItem,
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>,
): { height: number; width: number } {
  const isParent = workItem.children.length > 0;
  const isExpanded = expandedParents.has(workItem.id);

  if (!isParent || !isExpanded) {
    return { height: NODE_HEIGHT, width: CHILD_WIDTH };
  }

  const childItems = workItem.children
    .map((childId) => workItemMap.get(childId))
    .filter((childWorkItem): childWorkItem is WorkItem => childWorkItem !== undefined);

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
 * Recursively render an expanded parent group (single-column).
 */
function renderExpandedGroup(
  workItem: WorkItem,
  x: number,
  y: number,
  reactFlowParentId: string | undefined,
  nodes: LayoutNode[],
  nodeIdMap: NodeIdMap,
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>,
  columnExtent?: [[number, number], [number, number]],
): { width: number; height: number } {
  const childItems = workItem.children
    .map((childId) => workItemMap.get(childId))
    .filter((childWorkItem): childWorkItem is WorkItem => childWorkItem !== undefined);

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

  const doneChildCount = workItem.children.filter((childId) => {
    const childWorkItem = workItemMap.get(childId);
    return childWorkItem && doneStates.has(childWorkItem.state);
  }).length;

  const groupId = `group-${workItem.id}`;
  nodeIdMap.set(workItem.id, groupId);

  const node: LayoutNode = {
    id: groupId,
    type: "parentGroup",
    position: { x, y },
    data: {
      label: workItem.title,
      workItemId: workItem.id,
      workItemType: workItem.work_item_type,
      state: workItem.state,
      childCount: workItem.children.length,
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
  } else if (columnExtent) {
    node.extent = columnExtent;
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
        doneStates,
      );
      childY += dims.height + NODE_GAP_Y;
    } else {
      const childDoneCount = child.children.filter((childId) => {
        const childWorkItem = workItemMap.get(childId);
        return childWorkItem && doneStates.has(childWorkItem.state);
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

/**
 * Find the earliest iteration path from a set, using the iteration date lookup.
 */
function findEarliestPath(
  paths: Set<string>,
  iterationByPath: Map<string, { start_date?: string | null }>,
): string {
  let earliest: string | null = null;
  let earliestDate: string | null = null;
  for (const p of paths) {
    const iter = iterationByPath.get(p);
    const date = iter?.start_date ?? p;
    if (!earliest || date < (earliestDate ?? "")) {
      earliest = p;
      earliestDate = date;
    }
  }
  return earliest ?? [...paths][0];
}

export function buildGraphLayout(boardData: BoardData, expandedParents: Set<number>): LayoutResult {
  const { work_items, iterations } = boardData;
  const nodes: LayoutNode[] = [];
  const edges: Edge[] = [];
  const nodeIdMap: NodeIdMap = new Map();

  if (work_items.length === 0) {
    return { nodes, edges };
  }

  const workItemMap = new Map(work_items.map((workItem) => [workItem.id, workItem]));
  const doneStates = new Set(["Done", "Closed", "Resolved", "Removed"]);
  const iterationByPath = new Map(iterations.map((it) => [it.path, it]));

  // --- Phase 1: Identify multi-sprint parents (always, regardless of expanded) ---
  const multiSprintParentIds = new Set<number>();
  const multiSprintDescendantIds = new Set<number>();
  // Cache descendant paths per multi-sprint parent
  const multiSprintPaths = new Map<number, Set<string>>();

  function markDescendants(id: number) {
    multiSprintDescendantIds.add(id);
    const workItem = workItemMap.get(id);
    if (workItem) {
      for (const childId of workItem.children) {
        markDescendants(childId);
      }
    }
  }

  for (const workItem of work_items) {
    if (workItem.parent_id && workItemMap.has(workItem.parent_id)) {
      continue;
    }
    if (!MULTI_SPRINT_TYPES.has(workItem.work_item_type)) {
      continue;
    }
    if (workItem.children.length === 0) {
      continue;
    }

    const descendantPaths = collectDescendantIterPaths(workItem, workItemMap);
    if (descendantPaths.size >= 2) {
      multiSprintParentIds.add(workItem.id);
      multiSprintPaths.set(workItem.id, descendantPaths);
      for (const childId of workItem.children) {
        markDescendants(childId);
      }
    }
  }

  // --- Phase 2: Determine columns and pre-compute positions ---
  // Collect iteration paths from non-multi-sprint-parent items
  const allIterPaths = new Set<string>();
  for (const workItem of work_items) {
    if (!multiSprintParentIds.has(workItem.id)) {
      allIterPaths.add(workItem.iteration_path);
    }
  }

  const iterationPaths = [...allIterPaths].sort((a, b) => {
    const iterA = iterationByPath.get(a);
    const iterB = iterationByPath.get(b);
    if (iterA?.start_date && iterB?.start_date) {
      return iterA.start_date.localeCompare(iterB.start_date);
    }
    return a.localeCompare(b);
  });

  // Pre-compute column x positions (fixed stride)
  const columnX = new Map<string, number>();
  iterationPaths.forEach((path, i) => {
    columnX.set(path, SPRINT_PADDING + i * COLUMN_STRIDE);
  });

  // Determine current sprint
  const now = new Date().toISOString();
  let currentIterPath: string | null = null;
  for (const [path, iter] of iterationByPath) {
    if (iter.start_date && iter.finish_date && iter.start_date <= now && now <= iter.finish_date) {
      currentIterPath = path;
      break;
    }
  }

  // --- Phase 3: Group items by home column ---
  // Multi-sprint parents go into their earliest descendant's column
  const iterationGroups = new Map<string, WorkItem[]>();

  for (const workItem of work_items) {
    // Skip descendants of multi-sprint parents
    if (multiSprintDescendantIds.has(workItem.id)) {
      continue;
    }
    // Skip children of non-multi-sprint parents
    if (
      workItem.parent_id &&
      workItemMap.has(workItem.parent_id) &&
      !multiSprintParentIds.has(workItem.id)
    ) {
      continue;
    }

    let homeCol: string;
    if (multiSprintParentIds.has(workItem.id)) {
      const descPaths = multiSprintPaths.get(workItem.id)!;
      homeCol = findEarliestPath(descPaths, iterationByPath);
    } else {
      homeCol = workItem.iteration_path;
    }

    const group = iterationGroups.get(homeCol) ?? [];
    group.push(workItem);
    iterationGroups.set(homeCol, group);
  }

  // --- Phase 4: Layout items per column (multi-sprint parents inline) ---
  // Shared Y tracker across columns — multi-sprint parents advance ALL spanned columns
  const columnCurrentY = new Map<string, number>();
  for (const p of iterationPaths) {
    columnCurrentY.set(p, TOP_OFFSET);
  }

  for (const iterPath of iterationPaths) {
    const colX = columnX.get(iterPath)!;
    const items = iterationGroups.get(iterPath) ?? [];

    const sortedItems = [...items].sort((a, b) => {
      const aDone = doneStates.has(a.state) ? 1 : 0;
      const bDone = doneStates.has(b.state) ? 1 : 0;
      return aDone - bDone;
    });

    let currentY = columnCurrentY.get(iterPath)!;
    for (const workItem of sortedItems) {
      const doneChildCount = workItem.children.filter((childId) => {
        const childWorkItem = workItemMap.get(childId);
        return childWorkItem && doneStates.has(childWorkItem.state);
      }).length;

      if (multiSprintParentIds.has(workItem.id)) {
        // --- Multi-sprint parent (inline, spanning columns) ---
        const descPaths = multiSprintPaths.get(workItem.id)!;
        const spannedXs = [...descPaths]
          .map((p) => columnX.get(p))
          .filter((x): x is number => !isNil(x));
        const minSpanX = Math.min(colX, ...spannedXs);
        const maxSpanX = Math.max(colX, ...spannedXs) + MIN_COLUMN_WIDTH;
        const spanWidth = maxSpanX - minSpanX + GROUP_PADDING * 2;
        const isExpanded = expandedParents.has(workItem.id);

        const multiSprintExtent: [[number, number], [number, number]] = [
          [minSpanX, TOP_OFFSET],
          [minSpanX + spanWidth, 10000],
        ];

        if (isExpanded) {
          // Expanded: spanning container with children in column slots
          const directChildren = workItem.children
            .map((childId) => workItemMap.get(childId))
            .filter((childWorkItem): childWorkItem is WorkItem => childWorkItem !== undefined);

          // Group children by column
          const childrenByIter = new Map<string, WorkItem[]>();
          for (const child of directChildren) {
            let placementPath = child.iteration_path;
            if (child.children.length > 0) {
              const childDescPaths = collectDescendantIterPaths(child, workItemMap);
              placementPath = findEarliestPath(childDescPaths, iterationByPath);
            }
            const group = childrenByIter.get(placementPath) ?? [];
            group.push(child);
            childrenByIter.set(placementPath, group);
          }

          // Measure max slot height
          let maxSlotHeight = 0;
          for (const [, children] of childrenByIter) {
            let h = 0;
            for (const child of children) {
              const m = measureChildHeight(child, workItemMap, expandedParents, doneStates);
              h += m.height + NODE_GAP_Y;
            }
            h -= NODE_GAP_Y;
            maxSlotHeight = Math.max(maxSlotHeight, h);
          }

          const groupHeight = HEADER_HEIGHT + GROUP_PADDING * 2 + maxSlotHeight;
          const groupId = `group-${workItem.id}`;
          nodeIdMap.set(workItem.id, groupId);

          nodes.push({
            id: groupId,
            type: "parentGroup",
            position: { x: minSpanX, y: currentY },
            data: {
              label: workItem.title,
              workItemId: workItem.id,
              workItemType: workItem.work_item_type,
              state: workItem.state,
              childCount: workItem.children.length,
              doneChildCount,
              width: spanWidth,
              height: groupHeight,
              onToggleExpand: undefined,
            },
            draggable: true,
            extent: multiSprintExtent,
            style: { width: spanWidth, height: groupHeight },
          });

          // Render children in their column slots
          for (const [childIterPath, children] of childrenByIter) {
            const childColX = columnX.get(childIterPath);
            if (isNil(childColX)) {
              continue;
            }
            const slotX = childColX - minSpanX + GROUP_PADDING;
            // Extent relative to parent group — constrain to this column slot
            const slotExtent: [[number, number], [number, number]] = [
              [slotX, HEADER_HEIGHT],
              [slotX + MIN_COLUMN_WIDTH - GROUP_PADDING * 2, groupHeight],
            ];
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
                  doneStates,
                );
                childY += dims.height + NODE_GAP_Y;
              } else {
                const childDoneCount = child.children.filter((childId) => {
                  const childWorkItem = workItemMap.get(childId);
                  return childWorkItem && doneStates.has(childWorkItem.state);
                }).length;
                const childNodeId = `wi-${child.id}`;
                nodeIdMap.set(child.id, childNodeId);
                nodes.push({
                  id: childNodeId,
                  type: "workItem",
                  position: { x: slotX, y: childY },
                  parentId: groupId,
                  extent: slotExtent,
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

          currentY += groupHeight + NODE_GAP_Y;
          // Push all spanned columns' Y below this expanded container
          for (const p of descPaths) {
            const existingY = columnCurrentY.get(p) ?? TOP_OFFSET;
            columnCurrentY.set(p, Math.max(existingY, currentY));
          }
        } else {
          const groupId = `group-${workItem.id}`;
          nodeIdMap.set(workItem.id, groupId);
          const collapsedHeight = NODE_HEIGHT;

          nodes.push({
            id: groupId,
            type: "parentGroup",
            position: { x: minSpanX, y: currentY },
            data: {
              label: workItem.title,
              workItemId: workItem.id,
              workItemType: workItem.work_item_type,
              state: workItem.state,
              childCount: workItem.children.length,
              doneChildCount,
              width: spanWidth,
              height: collapsedHeight,
              onToggleExpand: undefined,
            },
            draggable: true,
            extent: multiSprintExtent,
            style: { width: spanWidth, height: collapsedHeight },
          });

          currentY += collapsedHeight + NODE_GAP_Y;
          // Push all spanned columns' Y below this collapsed bar
          for (const p of descPaths) {
            const existingY = columnCurrentY.get(p) ?? TOP_OFFSET;
            columnCurrentY.set(p, Math.max(existingY, currentY));
          }
        }
      } else {
        // --- Regular work item ---
        const isParent = workItem.children.length > 0;
        const isExpanded = expandedParents.has(workItem.id);

        if (isParent && isExpanded) {
          const colExtent: [[number, number], [number, number]] = [
            [colX, TOP_OFFSET],
            [colX + MIN_COLUMN_WIDTH, 10000],
          ];
          const { width: gw, height: gh } = renderExpandedGroup(
            workItem,
            colX,
            currentY,
            undefined,
            nodes,
            nodeIdMap,
            workItemMap,
            expandedParents,
            doneStates,
            colExtent,
          );
          // gw tracked but column width is fixed at MIN_COLUMN_WIDTH
          void gw;
          currentY += gh + NODE_GAP_Y;
        } else {
          const nodeId = `wi-${workItem.id}`;
          nodeIdMap.set(workItem.id, nodeId);
          const extentBounds: CoordExtent = [
            [colX, TOP_OFFSET],
            [colX + MIN_COLUMN_WIDTH, 10000],
          ];
          nodes.push({
            id: nodeId,
            type: "workItem",
            position: { x: colX, y: currentY },
            extent: extentBounds,
            data: {
              workItem,
              isParent,
              isExpanded: false,
              childCount: workItem.children.length,
              doneChildCount,
            },
            draggable: true,
          });
          currentY += NODE_HEIGHT + NODE_GAP_Y;
        }
      }
    }

    columnCurrentY.set(iterPath, currentY);
  }

  // --- Phase 5: Sprint dividers (heights based on tallest column) ---
  let overallMaxY = TOP_OFFSET + NODE_HEIGHT * 3;
  for (const y of columnCurrentY.values()) {
    overallMaxY = Math.max(overallMaxY, y);
  }

  for (const iterPath of iterationPaths) {
    const colStartX = columnX.get(iterPath)!;
    const iterName = iterPath.split("\\").pop() ?? iterPath;
    const iterInfo = iterationByPath.get(iterPath);
    const isCurrent = iterPath === currentIterPath;

    nodes.push({
      id: `sprint-${iterPath}`,
      type: "sprintDivider",
      position: { x: colStartX - SPRINT_PADDING / 2, y: 0 },
      data: {
        label: iterName,
        startDate: iterInfo?.start_date ?? null,
        finishDate: iterInfo?.finish_date ?? null,
        height: overallMaxY + SPRINT_PADDING,
        width: MIN_COLUMN_WIDTH + SPRINT_PADDING,
        isCurrent,
      },
      draggable: false,
      style: { zIndex: -1 },
    });
  }

  // --- Build edges using rendered node IDs ---
  for (const workItem of work_items) {
    for (const succId of workItem.successors) {
      if (workItemMap.has(succId)) {
        const sourceId = nodeIdMap.get(workItem.id) ?? `wi-${workItem.id}`;
        const targetId = nodeIdMap.get(succId) ?? `wi-${succId}`;
        edges.push({
          id: `edge-${workItem.id}-${succId}`,
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
