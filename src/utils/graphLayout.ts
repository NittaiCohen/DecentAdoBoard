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
const COLUMN_STRIDE = MIN_COLUMN_WIDTH + NODE_GAP_X;
const SUB_COLUMN_WIDTH = 280;
const SUB_COLUMN_STRIDE = SUB_COLUMN_WIDTH + NODE_GAP_X;

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
const MIN_MULTI_SPRINT_PATHS = 2;
const Y_EXTENT_MAX = 10000;
const MIN_DIVIDER_HEIGHT_ROWS = 3;

type NodeIdMap = Map<number, string>;

/**
 * Compute dependency depth for a set of items using Kahn's algorithm.
 * Returns a map of item ID → depth (0 = no predecessors in the set).
 */
function computeDependencyDepths(
  items: WorkItem[],
  workItemMap: Map<number, WorkItem>,
): { depths: Map<number, number>; maxDepth: number } {
  const itemIds = new Set(items.map((item) => item.id));

  const localInDeg = new Map<number, number>();
  for (const item of items) {
    let deg = 0;
    for (const predId of item.predecessors) {
      if (itemIds.has(predId)) {
        deg++;
      }
    }
    localInDeg.set(item.id, deg);
  }

  const queue: number[] = [];
  const depths = new Map<number, number>();
  for (const [id, deg] of localInDeg) {
    if (deg === 0) {
      queue.push(id);
      depths.set(id, 0);
    }
  }

  let maxDepth = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    const item = workItemMap.get(id);
    if (!item) {
      continue;
    }
    const myDepth = depths.get(id) ?? 0;

    for (const succId of item.successors) {
      if (!itemIds.has(succId)) {
        continue;
      }
      const newDepth = myDepth + 1;
      const existingDepth = depths.get(succId) ?? 0;
      if (newDepth > existingDepth) {
        depths.set(succId, newDepth);
      }
      maxDepth = Math.max(maxDepth, newDepth);

      const newDeg = (localInDeg.get(succId) ?? 1) - 1;
      localInDeg.set(succId, newDeg);
      if (newDeg === 0) {
        queue.push(succId);
      }
    }
  }

  // Items not reached by Kahn's (e.g., cycles) get depth 0
  for (const item of items) {
    if (!depths.has(item.id)) {
      depths.set(item.id, 0);
    }
  }

  return { depths, maxDepth };
}

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
    if (descendantPaths.size >= MIN_MULTI_SPRINT_PATHS) {
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

  // --- Phase 3: Group items by home sprint column ---
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

  // --- Phase 3b: Compute effective columns based on dependencies ---
  // Within each sprint, items with same-sprint predecessors get pushed to sub-columns
  const sprintColIndex = new Map<string, number>();
  iterationPaths.forEach((path, i) => {
    sprintColIndex.set(path, i);
  });

  const withinSprintDepth = new Map<number, number>();
  const sprintWidths = new Map<string, number>();

  for (const iterPath of iterationPaths) {
    const items = iterationGroups.get(iterPath) ?? [];
    if (items.length === 0) {
      sprintWidths.set(iterPath, 1);
      continue;
    }

    const { depths, maxDepth } = computeDependencyDepths(items, workItemMap);
    for (const [id, depth] of depths) {
      withinSprintDepth.set(id, depth);
    }

    sprintWidths.set(iterPath, maxDepth + 1);
  }

  // Also consider children of multi-sprint parents for sprint width computation
  // Pre-compute per-sprint child dependency depths and store for reuse in Phase 4
  const multiSprintChildDepths = new Map<number, number>();
  for (const parentId of multiSprintParentIds) {
    const parent = workItemMap.get(parentId);
    if (!parent) {
      continue;
    }
    const directChildren = parent.children
      .map((childId) => workItemMap.get(childId))
      .filter((child): child is WorkItem => child !== undefined);

    // Group children by their placement sprint
    const childrenBySprint = new Map<string, WorkItem[]>();
    for (const child of directChildren) {
      let placementPath = child.iteration_path;
      if (child.children.length > 0) {
        const childDescPaths = collectDescendantIterPaths(child, workItemMap);
        placementPath = findEarliestPath(childDescPaths, iterationByPath);
      }
      const group = childrenBySprint.get(placementPath) ?? [];
      group.push(child);
      childrenBySprint.set(placementPath, group);
    }

    // Compute per-sprint dependency depths and widen sprint if needed
    for (const [sprintPath, sprintChildren] of childrenBySprint) {
      const { depths, maxDepth } = computeDependencyDepths(sprintChildren, workItemMap);
      for (const [id, depth] of depths) {
        multiSprintChildDepths.set(id, depth);
      }
      const currentWidth = sprintWidths.get(sprintPath) ?? 1;
      if (maxDepth + 1 > currentWidth) {
        sprintWidths.set(sprintPath, maxDepth + 1);
      }
    }
  }

  // Compute sprint starting effective columns (non-overlapping)
  const sprintStartCol = new Map<string, number>();
  let effColStart = 0;
  for (const path of iterationPaths) {
    sprintStartCol.set(path, effColStart);
    effColStart += sprintWidths.get(path) ?? 1;
  }

  // Compute each item's effective column
  const itemEffCol = new Map<number, number>();
  for (const [iterPath, items] of iterationGroups) {
    const base = sprintStartCol.get(iterPath) ?? 0;
    for (const item of items) {
      const depth = withinSprintDepth.get(item.id) ?? 0;
      itemEffCol.set(item.id, base + depth);
    }
  }

  // Cross-sprint forward pass: ensure successors are to the right of predecessors
  const allColumnItemIds = new Set(itemEffCol.keys());
  let crossShifted = true;
  while (crossShifted) {
    crossShifted = false;
    for (const id of allColumnItemIds) {
      const item = workItemMap.get(id)!;
      const myCol = itemEffCol.get(id)!;
      for (const succId of item.successors) {
        const succCol = itemEffCol.get(succId);
        if (succCol !== undefined && succCol <= myCol) {
          itemEffCol.set(succId, myCol + 1);
          crossShifted = true;
        }
      }
    }
  }

  // Determine max effective column
  let maxEffCol = effColStart - 1;
  for (const col of itemEffCol.values()) {
    maxEffCol = Math.max(maxEffCol, col);
  }

  // Build effective column X positions
  // Each sprint's first sub-column gets COLUMN_STRIDE spacing from other sprints
  // Additional sub-columns within a sprint use the smaller SUB_COLUMN_STRIDE
  const effColumnX = new Map<number, number>();
  for (const path of iterationPaths) {
    const startCol = sprintStartCol.get(path) ?? 0;
    const width = sprintWidths.get(path) ?? 1;
    const sprintBaseX = SPRINT_PADDING + sprintStartCol.get(path)! * COLUMN_STRIDE;

    // Adjust: only the first sub-column per sprint uses full COLUMN_STRIDE from previous sprint
    // Subsequent sub-columns within the sprint use SUB_COLUMN_STRIDE offsets
    // Recompute: sprint base X accounts for prior sprints' sub-column widths
    for (let sub = 0; sub < width; sub++) {
      effColumnX.set(startCol + sub, sprintBaseX + sub * SUB_COLUMN_STRIDE);
    }
  }

  // Recalculate sprint base X properly: each sprint starts after the previous sprint's full width
  effColumnX.clear();
  let sprintBaseX = SPRINT_PADDING;
  for (const path of iterationPaths) {
    const startCol = sprintStartCol.get(path) ?? 0;
    const width = sprintWidths.get(path) ?? 1;
    for (let sub = 0; sub < width; sub++) {
      effColumnX.set(startCol + sub, sprintBaseX + sub * SUB_COLUMN_STRIDE);
    }
    // Next sprint starts after this sprint's columns
    // First sub-col = MIN_COLUMN_WIDTH, additional sub-cols = SUB_COLUMN_STRIDE each
    sprintBaseX +=
      MIN_COLUMN_WIDTH + (width > 1 ? (width - 1) * SUB_COLUMN_STRIDE : 0) + NODE_GAP_X;
  }

  // Build groups by effective column
  const effColumnGroups = new Map<number, WorkItem[]>();
  for (const [id, col] of itemEffCol) {
    const item = workItemMap.get(id)!;
    const group = effColumnGroups.get(col) ?? [];
    group.push(item);
    effColumnGroups.set(col, group);
  }

  // Update columnX to map sprint paths → effective X positions (for multi-sprint parent rendering)
  columnX.clear();
  for (const path of iterationPaths) {
    const startCol = sprintStartCol.get(path)!;
    columnX.set(path, effColumnX.get(startCol)!);
  }

  // --- Phase 4: Layout items per effective column ---
  const columnCurrentY = new Map<number, number>();
  for (let i = 0; i <= maxEffCol; i++) {
    columnCurrentY.set(i, TOP_OFFSET);
  }

  for (let effCol = 0; effCol <= maxEffCol; effCol++) {
    const colX = effColumnX.get(effCol)!;
    const items = effColumnGroups.get(effCol) ?? [];

    const sortedItems = [...items].sort((a, b) => {
      const aDone = doneStates.has(a.state) ? 1 : 0;
      const bDone = doneStates.has(b.state) ? 1 : 0;
      return aDone - bDone;
    });

    let currentY = columnCurrentY.get(effCol)!;
    for (const workItem of sortedItems) {
      const doneChildCount = workItem.children.filter((childId) => {
        const childWorkItem = workItemMap.get(childId);
        return childWorkItem && doneStates.has(childWorkItem.state);
      }).length;

      if (multiSprintParentIds.has(workItem.id)) {
        // --- Multi-sprint parent (inline, spanning columns) ---
        const descPaths = multiSprintPaths.get(workItem.id)!;
        // Compute the full X extent of spanned sprints, accounting for sub-columns
        const spannedRanges = [...descPaths]
          .map((p) => {
            const x = columnX.get(p);
            const w = sprintWidths.get(p) ?? 1;
            return x !== undefined
              ? { start: x, end: x + MIN_COLUMN_WIDTH + (w > 1 ? (w - 1) * SUB_COLUMN_STRIDE : 0) }
              : null;
          })
          .filter((r): r is { start: number; end: number } => r !== null);
        const minSpanX = Math.min(colX, ...spannedRanges.map((r) => r.start));
        const maxSpanX = Math.max(colX + MIN_COLUMN_WIDTH, ...spannedRanges.map((r) => r.end));
        const spanWidth = maxSpanX - minSpanX + GROUP_PADDING * 2;
        const isExpanded = expandedParents.has(workItem.id);

        const multiSprintExtent: [[number, number], [number, number]] = [
          [minSpanX, TOP_OFFSET],
          [minSpanX + spanWidth, Y_EXTENT_MAX],
        ];

        if (isExpanded) {
          // Expanded: spanning container with children in column slots
          const directChildren = workItem.children
            .map((childId) => workItemMap.get(childId))
            .filter((childWorkItem): childWorkItem is WorkItem => childWorkItem !== undefined);

          // Determine each child's placement sprint
          const childPathMap = new Map<number, string>();
          for (const child of directChildren) {
            let placementPath = child.iteration_path;
            if (child.children.length > 0) {
              const childDescPaths = collectDescendantIterPaths(child, workItemMap);
              placementPath = findEarliestPath(childDescPaths, iterationByPath);
            }
            childPathMap.set(child.id, placementPath);
          }

          // Group children by effective sub-column key (path + depth)
          // Depths were pre-computed in Phase 3b and stored in multiSprintChildDepths
          const childrenBySubCol = new Map<string, WorkItem[]>();
          for (const child of directChildren) {
            const path = childPathMap.get(child.id) ?? child.iteration_path;
            const depth = multiSprintChildDepths.get(child.id) ?? 0;
            const key = `${path}:${depth}`;
            const group = childrenBySubCol.get(key) ?? [];
            group.push(child);
            childrenBySubCol.set(key, group);
          }

          // Measure max sub-column height
          let maxSlotHeight = 0;
          for (const [, children] of childrenBySubCol) {
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

          // Render children in their dependency-aware sub-column slots
          // Child X positions align with external sprint divider columns
          for (const [subColKey, children] of childrenBySubCol) {
            const [childIterPath, depthStr] = subColKey.split(":");
            const depth = Number(depthStr);
            const externalX = columnX.get(childIterPath);
            const baseSlotX =
              externalX !== undefined ? externalX - minSpanX + GROUP_PADDING : GROUP_PADDING;
            const slotX = baseSlotX + depth * SUB_COLUMN_STRIDE;
            const slotExtent: [[number, number], [number, number]] = [
              [slotX, HEADER_HEIGHT],
              [slotX + SUB_COLUMN_WIDTH - GROUP_PADDING * 2, groupHeight],
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
          // Push all spanned effective columns' Y below this expanded container
          for (const p of descPaths) {
            const startC = sprintStartCol.get(p) ?? 0;
            const width = sprintWidths.get(p) ?? 1;
            for (let c = startC; c < startC + width; c++) {
              const existingY = columnCurrentY.get(c) ?? TOP_OFFSET;
              columnCurrentY.set(c, Math.max(existingY, currentY));
            }
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
          // Push all spanned effective columns' Y below this collapsed bar
          for (const p of descPaths) {
            const startC = sprintStartCol.get(p) ?? 0;
            const width = sprintWidths.get(p) ?? 1;
            for (let c = startC; c < startC + width; c++) {
              const existingY = columnCurrentY.get(c) ?? TOP_OFFSET;
              columnCurrentY.set(c, Math.max(existingY, currentY));
            }
          }
        }
      } else {
        // --- Regular work item ---
        const isParent = workItem.children.length > 0;
        const isExpanded = expandedParents.has(workItem.id);

        if (isParent && isExpanded) {
          const colExtent: [[number, number], [number, number]] = [
            [colX, TOP_OFFSET],
            [colX + MIN_COLUMN_WIDTH, Y_EXTENT_MAX],
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
            [colX + MIN_COLUMN_WIDTH, Y_EXTENT_MAX],
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

    columnCurrentY.set(effCol, currentY);
  }

  // --- Phase 5: Sprint dividers (heights based on tallest column) ---
  let overallMaxY = TOP_OFFSET + NODE_HEIGHT * MIN_DIVIDER_HEIGHT_ROWS;
  for (const y of columnCurrentY.values()) {
    overallMaxY = Math.max(overallMaxY, y);
  }

  for (const iterPath of iterationPaths) {
    const startCol = sprintStartCol.get(iterPath)!;
    const width = sprintWidths.get(iterPath) ?? 1;
    const colStartX = effColumnX.get(startCol)!;
    const dividerWidth =
      MIN_COLUMN_WIDTH + (width > 1 ? (width - 1) * SUB_COLUMN_STRIDE : 0) + SPRINT_PADDING;
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
        width: dividerWidth,
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
