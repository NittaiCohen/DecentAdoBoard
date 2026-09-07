import { MarkerType, type Edge } from "@xyflow/react";
import { isNil } from "lodash-es";
import type { BoardData, Iteration, Point, WorkItem } from "../types";
import type { WorkItemNodeData } from "../components/WorkItemNode";
import type { SprintDividerData } from "../components/SprintDivider";
import type { ParentGroupData } from "../components/ParentGroup";
import { BOARD_NODE_TYPES, isBoardNodeType, type BoardNodeType } from "../types/graph";
import { computeActionableSet, DONE_STATES } from "./actionable";
import { mapBy } from "./collections";
import { assignLaneOffsets } from "./edgeRouting";

export const NODE_HEIGHT = 80;
export const NODE_GAP_X = 60;
export const NODE_GAP_Y = 20;
export const SPRINT_PADDING = 40;
const MIN_COLUMN_WIDTH = 1200;
const TOP_OFFSET = 60;
export const SUB_COLUMN_WIDTH = 280;
export const SUB_COLUMN_STRIDE = SUB_COLUMN_WIDTH + NODE_GAP_X;

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  type?: BoardNodeType;
}

type AnyNodeData = WorkItemNodeData | SprintDividerData | ParentGroupData | DragGhostData;

export interface DragGhostData extends Record<string, unknown> {
  width: number;
  height: number;
}

type CoordExtent = [[number, number], [number, number]];

interface LayoutNode {
  id: string;
  type: BoardNodeType;
  position: Point;
  data: AnyNodeData;
  parentId?: string;
  extent?: "parent" | CoordExtent;
  draggable?: boolean;
  selectable?: boolean;
  focusable?: boolean;
  className?: string;
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
const WORK_ITEM_TYPE_ORDER: Record<string, number> = {
  Epic: 0,
  Feature: 1,
};
const DEFAULT_WORK_ITEM_TYPE_ORDER = 2;

type NodeIdMap = Map<number, string>;

function getWorkItemTypeOrder(workItem: WorkItem): number {
  return WORK_ITEM_TYPE_ORDER[workItem.type] ?? DEFAULT_WORK_ITEM_TYPE_ORDER;
}

/** Resolve an array of work item IDs to their WorkItem objects, dropping any that aren't in the map. */
function resolveWorkItemIds(ids: number[], workItemMap: Map<number, WorkItem>): WorkItem[] {
  return ids
    .map((id) => workItemMap.get(id))
    .filter((item): item is WorkItem => item !== undefined);
}

/**
 * Compute dependency depth for a set of items using Kahn's algorithm.
 * Returns a map of item ID → depth (0 = no predecessors in the set).
 */
function countPredecessorsInSet(items: WorkItem[], itemIds: Set<number>): Map<number, number> {
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
  return localInDeg;
}

export function computeDependencyDepths(
  items: WorkItem[],
  workItemMap: Map<number, WorkItem>,
): { depths: Map<number, number>; maxDepth: number } {
  const itemIds = new Set(items.map((item) => item.id));
  const predecessorsInSet = countPredecessorsInSet(items, itemIds);

  const queue: number[] = [];
  const depths = new Map<number, number>();
  for (const [id, deg] of predecessorsInSet) {
    if (deg === 0) {
      queue.push(id);
      depths.set(id, 0);
    }
  }

  let maxDepth = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (isNil(id)) {
      continue;
    }
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

      const newDeg = (predecessorsInSet.get(succId) ?? 1) - 1;
      predecessorsInSet.set(succId, newDeg);
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
  const children = resolveWorkItemIds(workItem.children, workItemMap);

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

interface GroupChildPlacement {
  item: WorkItem;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GroupLayout {
  width: number;
  height: number;
  placements: GroupChildPlacement[];
}

/**
 * Compute multi-column layout for children inside an expanded group.
 * Uses dependency depths to arrange children in columns left-to-right,
 * aligning successors with their predecessors vertically.
 */
function computeGroupLayout(
  childItems: WorkItem[],
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>,
): GroupLayout {
  if (childItems.length === 0) {
    return {
      width: CHILD_WIDTH + GROUP_PADDING * 2,
      height: HEADER_HEIGHT + GROUP_PADDING * 2,
      placements: [],
    };
  }

  const { depths, maxDepth } = computeDependencyDepths(childItems, workItemMap);

  const columns = new Map<number, WorkItem[]>();
  const childSizes = new Map<number, { width: number; height: number }>();

  for (const child of childItems) {
    const depth = depths.get(child.id) ?? 0;
    const col = columns.get(depth);
    if (col) {
      col.push(child);
    } else {
      columns.set(depth, [child]);
    }
    childSizes.set(child.id, measureChildHeight(child, workItemMap, expandedParents, doneStates));
  }

  const columnWidths = computeColumnWidths(columns, childSizes, maxDepth);
  const columnXOffsets = computeColumnXOffsets(columnWidths, maxDepth);
  const placements = placeChildrenInColumns(columns, childSizes, columnXOffsets, maxDepth);

  let maxBottom = HEADER_HEIGHT + GROUP_PADDING;
  for (const p of placements) {
    maxBottom = Math.max(maxBottom, p.y + p.height);
  }

  const lastColEnd = columnXOffsets[maxDepth] + columnWidths[maxDepth];
  return {
    width: lastColEnd + GROUP_PADDING,
    height: maxBottom + GROUP_PADDING,
    placements,
  };
}

/** Compute the maximum child width per depth column. */
function computeColumnWidths(
  columns: Map<number, WorkItem[]>,
  childSizes: Map<number, { width: number; height: number }>,
  maxDepth: number,
): number[] {
  const widths: number[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    const col = columns.get(d) ?? [];
    let maxW = CHILD_WIDTH;
    for (const child of col) {
      maxW = Math.max(maxW, childSizes.get(child.id)?.width ?? CHILD_WIDTH);
    }
    widths.push(maxW);
  }
  return widths;
}

/** Compute cumulative X offsets for each depth column. */
function computeColumnXOffsets(columnWidths: number[], maxDepth: number): number[] {
  const offsets: number[] = [GROUP_PADDING];
  for (let d = 1; d <= maxDepth; d++) {
    offsets.push(offsets[d - 1] + columnWidths[d - 1] + NODE_GAP_X);
  }
  return offsets;
}

/**
 * Place children into columns with predecessor Y alignment.
 * Processes columns left-to-right so predecessors are positioned before successors.
 */
function placeChildrenInColumns(
  columns: Map<number, WorkItem[]>,
  childSizes: Map<number, { width: number; height: number }>,
  columnXOffsets: number[],
  maxDepth: number,
): GroupChildPlacement[] {
  const placements: GroupChildPlacement[] = [];
  const childYPositions = new Map<number, number>();
  const subColCurrentY = new Map<string, number>();

  for (let d = 0; d <= maxDepth; d++) {
    const col = columns.get(d) ?? [];
    for (const child of col) {
      const size = childSizes.get(child.id) ?? { width: CHILD_WIDTH, height: NODE_HEIGHT };
      const subColKey = String(d);
      const y = computeChildY(child, d, childYPositions, subColCurrentY, subColKey);

      placements.push({
        item: child,
        x: columnXOffsets[d],
        y,
        width: size.width,
        height: size.height,
      });
      childYPositions.set(child.id, y);
      subColCurrentY.set(subColKey, y + size.height + NODE_GAP_Y);
    }
  }

  return placements;
}

/**
 * Measure the height and width a work item will occupy inside a group.
 * For expanded parents, computes multi-column layout dimensions.
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

  const childItems = resolveWorkItemIds(workItem.children, workItemMap);

  const layout = computeGroupLayout(childItems, workItemMap, expandedParents, doneStates);
  return { height: layout.height, width: layout.width };
}

interface RenderContext {
  nodes: LayoutNode[];
  nodeIdMap: NodeIdMap;
  workItemMap: Map<number, WorkItem>;
  expandedParents: Set<number>;
  doneStates: Set<string>;
  actionableSet: Set<number>;
}

/** Count how many of a work item's direct children are in a done state. */
function countDoneChildren(workItem: WorkItem, ctx: RenderContext): number {
  return workItem.children.filter((childId) => {
    const child = ctx.workItemMap.get(childId);
    return child && ctx.doneStates.has(child.state);
  }).length;
}

/** Measure the dimensions of an expanded group using multi-column child layout. */
function measureGroupDimensions(childItems: WorkItem[], ctx: RenderContext): GroupLayout {
  return computeGroupLayout(childItems, ctx.workItemMap, ctx.expandedParents, ctx.doneStates);
}

/** Render child work item nodes inside an expanded group using pre-computed placements. */
function renderChildNodes(layout: GroupLayout, groupId: string, ctx: RenderContext): void {
  for (const placement of layout.placements) {
    const child = placement.item;
    const childIsParent = child.children.length > 0;
    const childIsExpanded = ctx.expandedParents.has(child.id);

    if (childIsParent && childIsExpanded) {
      renderExpandedGroup(child, placement.x, placement.y, groupId, ctx);
    } else {
      const childDoneCount = countDoneChildren(child, ctx);
      const childNodeId = `wi-${child.id}`;
      ctx.nodeIdMap.set(child.id, childNodeId);
      ctx.nodes.push({
        id: childNodeId,
        type: BOARD_NODE_TYPES.workItem,
        position: { x: placement.x, y: placement.y },
        parentId: groupId,
        extent: "parent",
        data: {
          workItem: child,
          isParent: childIsParent,
          isExpanded: false,
          isActionable: ctx.actionableSet.has(child.id),
          childCount: child.children.length,
          doneChildCount: childDoneCount,
        },
        draggable: true,
      });
    }
  }
}
function renderExpandedGroup(
  workItem: WorkItem,
  x: number,
  y: number,
  reactFlowParentId: string | undefined,
  ctx: RenderContext,
  columnExtent?: CoordExtent,
): { width: number; height: number } {
  const children = resolveWorkItemIds(workItem.children, ctx.workItemMap);

  const layout = measureGroupDimensions(children, ctx);
  const doneChildCount = countDoneChildren(workItem, ctx);

  const groupId = `group-${workItem.id}`;
  ctx.nodeIdMap.set(workItem.id, groupId);

  const node: LayoutNode = {
    id: groupId,
    type: BOARD_NODE_TYPES.parentGroup,
    position: { x, y },
    data: {
      label: workItem.title,
      workItemId: workItem.id,
      workItemType: workItem.type,
      state: workItem.state,
      childCount: workItem.children.length,
      doneChildCount,
      width: layout.width,
      height: layout.height,
      onToggleExpand: undefined,
    },
    draggable: !MULTI_SPRINT_TYPES.has(workItem.type),
    style: { width: layout.width, height: layout.height },
  };
  if (reactFlowParentId) {
    node.parentId = reactFlowParentId;
    node.extent = "parent";
  } else if (columnExtent) {
    node.extent = columnExtent;
  }
  ctx.nodes.push(node);

  renderChildNodes(layout, groupId, ctx);

  return { width: layout.width, height: layout.height };
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

/** Determine which sprint a work item should be placed in: its own iteration for leaves, or the earliest descendant sprint for parents. */
function getPlacementPath(
  item: WorkItem,
  workItemMap: Map<number, WorkItem>,
  iterationByPath: Map<string, { start_date?: string | null }>,
): string {
  if (item.children.length === 0) {
    return item.iteration_path;
  }
  const descPaths = collectDescendantIterPaths(item, workItemMap);
  return findEarliestPath(descPaths, iterationByPath);
}

// --- Phase result types ---

interface MultiSprintInfo {
  parentIds: Set<number>;
  descendantIds: Set<number>;
  paths: Map<number, Set<string>>;
}

interface IterationInfo {
  iterationPaths: string[];
  iterationByPath: Map<string, Iteration>;
  currentIterPath: string | null;
  iterationGroups: Map<string, WorkItem[]>;
}

interface ColumnPlan {
  sprintWidths: Map<string, number>;
  sprintStartCol: Map<string, number>;
  effectiveColumnByItemId: Map<number, number>;
  xPositionByColumn: Map<number, number>;
  workItemsByColumn: Map<number, WorkItem[]>;
  columnX: Map<string, number>;
  maxColumnIndex: number;
  multiSprintChildDepths: Map<number, number>;
}

// --- Phase 1: Identify multi-sprint parents ---

/** Recursively add a work item and all its descendants to the target set. */
function markDescendants(
  id: number,
  workItemMap: Map<number, WorkItem>,
  targetSet: Set<number>,
): void {
  targetSet.add(id);
  const workItem = workItemMap.get(id);
  if (workItem) {
    for (const childId of workItem.children) {
      markDescendants(childId, workItemMap, targetSet);
    }
  }
}

/** Identify top-level Epic/Feature parents whose children span multiple sprints. */
function identifyMultiSprintParents(
  workItems: WorkItem[],
  workItemMap: Map<number, WorkItem>,
): MultiSprintInfo {
  const parentIds = new Set<number>();
  const descendantIds = new Set<number>();
  const paths = new Map<number, Set<string>>();

  for (const workItem of workItems) {
    if (workItem.parent_id && workItemMap.has(workItem.parent_id)) {
      continue;
    }
    if (!MULTI_SPRINT_TYPES.has(workItem.type)) {
      continue;
    }
    if (workItem.children.length === 0) {
      continue;
    }

    const descendantPaths = collectDescendantIterPaths(workItem, workItemMap);
    if (descendantPaths.size >= MIN_MULTI_SPRINT_PATHS) {
      parentIds.add(workItem.id);
      paths.set(workItem.id, descendantPaths);
      for (const childId of workItem.children) {
        markDescendants(childId, workItemMap, descendantIds);
      }
    }
  }

  return { parentIds, descendantIds, paths };
}

// --- Phase 2: Sort iterations and group items by sprint ---

/** Sort iterations chronologically and group work items by sprint. */
function buildIterationInfo(
  workItems: WorkItem[],
  iterations: Iteration[],
  multiSprint: MultiSprintInfo,
  workItemMap: Map<number, WorkItem>,
): IterationInfo {
  const iterationByPath = new Map(iterations.map((it) => [it.path, it]));

  const allIterPaths = new Set<string>();
  for (const workItem of workItems) {
    if (!multiSprint.parentIds.has(workItem.id)) {
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

  const now = new Date().toISOString();
  let currentIterPath: string | null = null;
  for (const [path, iter] of iterationByPath) {
    if (iter.start_date && iter.finish_date && iter.start_date <= now && now <= iter.finish_date) {
      currentIterPath = path;
      break;
    }
  }

  const iterationGroups = groupItemsBySprint(workItems, multiSprint, workItemMap, iterationByPath);

  return { iterationPaths, iterationByPath, currentIterPath, iterationGroups };
}

/** Assign each visible work item to its home sprint column. */
function groupItemsBySprint(
  workItems: WorkItem[],
  multiSprint: MultiSprintInfo,
  workItemMap: Map<number, WorkItem>,
  iterationByPath: Map<string, Iteration>,
): Map<string, WorkItem[]> {
  const eligible = workItems.filter((workItem) => {
    if (multiSprint.descendantIds.has(workItem.id)) {
      return false;
    }

    if (
      workItem.parent_id &&
      workItemMap.has(workItem.parent_id) &&
      !multiSprint.parentIds.has(workItem.id)
    ) {
      return false;
    }

    if (multiSprint.parentIds.has(workItem.id) && !multiSprint.paths.has(workItem.id)) {
      return false;
    }

    return true;
  });

  return mapBy(eligible, (workItem) => {
    if (multiSprint.parentIds.has(workItem.id)) {
      const descPaths = multiSprint.paths.get(workItem.id) ?? new Set<string>();
      return findEarliestPath(descPaths, iterationByPath);
    }

    return workItem.iteration_path;
  });
}

// --- Phase 3: Compute effective columns ---

/** Compute dependency depths within each sprint and determine how many columns each sprint needs. */
function computeSprintDepths(
  iterInfo: IterationInfo,
  workItemMap: Map<number, WorkItem>,
): { withinSprintDepth: Map<number, number>; sprintWidths: Map<string, number> } {
  const withinSprintDepth = new Map<number, number>();
  const sprintWidths = new Map<string, number>();

  for (const iterPath of iterInfo.iterationPaths) {
    const items = iterInfo.iterationGroups.get(iterPath) ?? [];
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

  return { withinSprintDepth, sprintWidths };
}

/** Compute dependency depths for children inside multi-sprint parent groups, widening sprint columns as needed. */
function computeMultiSprintChildDepths(
  multiSprint: MultiSprintInfo,
  workItemMap: Map<number, WorkItem>,
  iterationByPath: Map<string, Iteration>,
  sprintWidths: Map<string, number>,
): Map<number, number> {
  const childDepths = new Map<number, number>();

  for (const parentId of multiSprint.parentIds) {
    const parent = workItemMap.get(parentId);
    if (!parent) {
      continue;
    }
    const directChildren = resolveWorkItemIds(parent.children, workItemMap);

    const childrenBySprint = new Map<string, WorkItem[]>();
    for (const child of directChildren) {
      const placementPath = getPlacementPath(child, workItemMap, iterationByPath);
      const group = childrenBySprint.get(placementPath) ?? [];
      group.push(child);
      childrenBySprint.set(placementPath, group);
    }

    for (const [sprintPath, sprintChildren] of childrenBySprint) {
      const { depths, maxDepth } = computeDependencyDepths(sprintChildren, workItemMap);
      for (const [id, depth] of depths) {
        childDepths.set(id, depth);
      }
      const currentWidth = sprintWidths.get(sprintPath) ?? 1;
      if (maxDepth + 1 > currentWidth) {
        sprintWidths.set(sprintPath, maxDepth + 1);
      }
    }
  }

  return childDepths;
}

/**
 * If an expanded parent group is wider than the sprint's current pixel width at
 * its depth position, widen the sprint so the group fits without overflow.
 */
function widenForItemIfNeeded(
  item: WorkItem,
  sprintPath: string,
  depth: number,
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>,
  sprintWidths: Map<string, number>,
): void {
  if (!expandedParents.has(item.id) || item.children.length === 0) {
    return;
  }

  const children = resolveWorkItemIds(item.children, workItemMap);

  const layout = computeGroupLayout(children, workItemMap, expandedParents, doneStates);

  const currentWidth = sprintWidths.get(sprintPath) ?? 1;
  const currentPixelWidth =
    MIN_COLUMN_WIDTH + (currentWidth > 1 ? (currentWidth - 1) * SUB_COLUMN_STRIDE : 0);
  const requiredPixelWidth = depth * SUB_COLUMN_STRIDE + layout.width;

  if (requiredPixelWidth > currentPixelWidth) {
    const additionalCols = Math.ceil((requiredPixelWidth - currentPixelWidth) / SUB_COLUMN_STRIDE);
    sprintWidths.set(sprintPath, currentWidth + additionalCols);
  }
}

/**
 * Pre-measure all expanded groups and widen sprints whose pixel width is too
 * narrow for any item placed inside them. Handles both top-level sprint items
 * and direct children of multi-sprint parents.
 */
function widenSprintsForExpandedItems(
  iterInfo: IterationInfo,
  multiSprint: MultiSprintInfo,
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>,
  withinSprintDepth: Map<number, number>,
  multiSprintChildDepths: Map<number, number>,
  sprintWidths: Map<string, number>,
): void {
  // Top-level items in each sprint (multi-sprint parents span multiple sprints
  // and are sized by computeMultiSprintSpan, so skip them here)

  iterInfo.iterationGroups.forEach((items, iterPath) => {
    items
      .filter((item) => !multiSprint.parentIds.has(item.id))
      .forEach((item) =>
        widenForItemIfNeeded(
          item,
          iterPath,
          withinSprintDepth.get(item.id) ?? 0,
          workItemMap,
          expandedParents,
          doneStates,
          sprintWidths,
        ),
      );
  });

  // Direct children of multi-sprint parents (nested multi-sprint parents are
  // sized by their own span, so skip them)
  resolveWorkItemIds([...multiSprint.parentIds], workItemMap)
    .flatMap((parent) => resolveWorkItemIds(parent.children, workItemMap))
    .filter((child) => !multiSprint.parentIds.has(child.id))
    .forEach((child) => {
      widenForItemIfNeeded(
        child,
        getPlacementPath(child, workItemMap, iterInfo.iterationByPath),
        multiSprintChildDepths.get(child.id) ?? 0,
        workItemMap,
        expandedParents,
        doneStates,
        sprintWidths,
      );
    });
}

/** Build the full column layout plan: effective column assignments, X positions, and column groupings. */
function buildColumnPlan(
  iterInfo: IterationInfo,
  multiSprint: MultiSprintInfo,
  workItemMap: Map<number, WorkItem>,
  expandedParents: Set<number>,
  doneStates: Set<string>,
): ColumnPlan {
  const { withinSprintDepth, sprintWidths } = computeSprintDepths(iterInfo, workItemMap);
  const multiSprintChildDepths = computeMultiSprintChildDepths(
    multiSprint,
    workItemMap,
    iterInfo.iterationByPath,
    sprintWidths,
  );

  widenSprintsForExpandedItems(
    iterInfo,
    multiSprint,
    workItemMap,
    expandedParents,
    doneStates,
    withinSprintDepth,
    multiSprintChildDepths,
    sprintWidths,
  );

  const { sprintStartCol, effectiveColumnByItemId, maxColumnIndex } = buildEffectiveColumns(
    iterInfo,
    withinSprintDepth,
    sprintWidths,
    workItemMap,
  );

  const xPositionByColumn = buildColumnXPositions(
    iterInfo.iterationPaths,
    sprintStartCol,
    sprintWidths,
  );

  return {
    sprintWidths,
    sprintStartCol,
    effectiveColumnByItemId,
    xPositionByColumn,
    workItemsByColumn: groupItemsByColumn(effectiveColumnByItemId, workItemMap),
    columnX: buildSprintColumnX(iterInfo.iterationPaths, sprintStartCol, xPositionByColumn),
    maxColumnIndex,
    multiSprintChildDepths,
  };
}

/** Assign each top-level item to an effective column index based on its sprint and dependency depth. */
function buildEffectiveColumns(
  iterInfo: IterationInfo,
  withinSprintDepth: Map<number, number>,
  sprintWidths: Map<string, number>,
  workItemMap: Map<number, WorkItem>,
): {
  sprintStartCol: Map<string, number>;
  effectiveColumnByItemId: Map<number, number>;
  maxColumnIndex: number;
} {
  const sprintStartCol = new Map<string, number>();
  let nextColumnIndex = 0;
  iterInfo.iterationPaths.forEach((path) => {
    sprintStartCol.set(path, nextColumnIndex);
    nextColumnIndex += sprintWidths.get(path) ?? 1;
  });

  const effectiveColumnByItemId = new Map<number, number>();
  iterInfo.iterationGroups.forEach((items, iterPath) => {
    const base = sprintStartCol.get(iterPath) ?? 0;
    items.forEach((item) => {
      effectiveColumnByItemId.set(item.id, base + (withinSprintDepth.get(item.id) ?? 0));
    });
  });

  enforceSuccessorOrdering(effectiveColumnByItemId, workItemMap);

  const maxColumnIndex = Math.max(nextColumnIndex - 1, ...effectiveColumnByItemId.values());

  return { sprintStartCol, effectiveColumnByItemId, maxColumnIndex };
}

/** Group work items by their effective column index. */
function groupItemsByColumn(
  effectiveColumnByItemId: Map<number, number>,
  workItemMap: Map<number, WorkItem>,
): Map<number, WorkItem[]> {
  const resolved = resolveWorkItemIds([...effectiveColumnByItemId.keys()], workItemMap);
  return mapBy(
    resolved.filter((item) => effectiveColumnByItemId.has(item.id)),
    (item) => effectiveColumnByItemId.get(item.id) ?? 0,
  );
}

/** Map each sprint path to the pixel X of its first effective column. */
function buildSprintColumnX(
  iterationPaths: string[],
  sprintStartCol: Map<string, number>,
  xPositionByColumn: Map<number, number>,
): Map<string, number> {
  const columnX = new Map<string, number>();
  iterationPaths.forEach((path) => {
    const startCol = sprintStartCol.get(path) ?? 0;
    const x = xPositionByColumn.get(startCol);
    if (!isNil(x)) {
      columnX.set(path, x);
    }
  });
  return columnX;
}

export function enforceSuccessorOrdering(
  effectiveColumnByItemId: Map<number, number>,
  workItemMap: Map<number, WorkItem>,
): void {
  const allColumnItemIds = [...effectiveColumnByItemId.keys()];
  const maxPasses = allColumnItemIds.length;

  for (let pass = 0; pass < maxPasses; pass++) {
    let crossShifted = false;

    for (const id of allColumnItemIds) {
      const item = workItemMap.get(id);
      const myCol = effectiveColumnByItemId.get(id);
      if (!item || isNil(myCol)) {
        continue;
      }

      for (const succId of item.successors) {
        const succCol = effectiveColumnByItemId.get(succId);
        if (!isNil(succCol) && succCol <= myCol) {
          effectiveColumnByItemId.set(succId, myCol + 1);
          crossShifted = true;
        }
      }
    }

    if (!crossShifted) {
      break;
    }
  }
}

/** Map each effective column index to its pixel X position. */
function buildColumnXPositions(
  iterationPaths: string[],
  sprintStartCol: Map<string, number>,
  sprintWidths: Map<string, number>,
): Map<number, number> {
  const xPositionByColumn = new Map<number, number>();
  let sprintBaseX = SPRINT_PADDING;
  for (const path of iterationPaths) {
    const startCol = sprintStartCol.get(path) ?? 0;
    const width = sprintWidths.get(path) ?? 1;
    for (let sub = 0; sub < width; sub++) {
      xPositionByColumn.set(startCol + sub, sprintBaseX + sub * SUB_COLUMN_STRIDE);
    }
    sprintBaseX +=
      MIN_COLUMN_WIDTH + (width > 1 ? (width - 1) * SUB_COLUMN_STRIDE : 0) + NODE_GAP_X;
  }
  return xPositionByColumn;
}

// --- Phase 4: Layout items per column ---

interface MultiSprintSpan {
  minSpanX: number;
  spanWidth: number;
  extent: CoordExtent;
}

/** Compute the horizontal span (pixel range and extent) of a multi-sprint parent across its descendant sprints. */
function computeMultiSprintSpan(
  colX: number,
  descPaths: Set<string>,
  columnX: Map<string, number>,
  sprintWidths: Map<string, number>,
): MultiSprintSpan {
  const spannedRanges = [...descPaths]
    .map((p) => {
      const x = columnX.get(p);
      const w = sprintWidths.get(p) ?? 1;
      return isNil(x)
        ? null
        : { start: x, end: x + MIN_COLUMN_WIDTH + (w > 1 ? (w - 1) * SUB_COLUMN_STRIDE : 0) };
    })
    .filter((r): r is { start: number; end: number } => r !== null);
  const minSpanX = Math.min(colX, ...spannedRanges.map((r) => r.start));
  const maxSpanX = Math.max(colX + MIN_COLUMN_WIDTH, ...spannedRanges.map((r) => r.end));
  const spanWidth = maxSpanX - minSpanX;
  const extent: CoordExtent = [
    [minSpanX, TOP_OFFSET],
    [minSpanX + spanWidth, Y_EXTENT_MAX],
  ];
  return { minSpanX, spanWidth, extent };
}

interface ChildPlacement {
  child: WorkItem;
  path: string;
  depth: number;
  slotX: number;
}

/** Determine the sprint placement and X slot for each direct child of a multi-sprint parent. */
function computeChildPlacements(
  directChildren: WorkItem[],
  workItemMap: Map<number, WorkItem>,
  iterationByPath: Map<string, Iteration>,
  multiSprintChildDepths: Map<number, number>,
  columnX: Map<string, number>,
  minSpanX: number,
  expandedParents: Set<number>,
  doneStates: Set<string>,
): ChildPlacement[] {
  const depthWidths = new Map<number, number>();
  for (const child of directChildren) {
    const depth = multiSprintChildDepths.get(child.id) ?? 0;
    const { width } = measureChildHeight(child, workItemMap, expandedParents, doneStates);
    depthWidths.set(depth, Math.max(depthWidths.get(depth) ?? CHILD_WIDTH, width));
  }

  const depthOffsets = new Map<number, number>();
  let accumulatedOffset = 0;
  for (const depth of [...depthWidths.keys()].sort((a, b) => a - b)) {
    depthOffsets.set(depth, accumulatedOffset);
    accumulatedOffset += (depthWidths.get(depth) ?? CHILD_WIDTH) + NODE_GAP_X;
  }

  const placements: ChildPlacement[] = [];
  for (const child of directChildren) {
    const placementPath = getPlacementPath(child, workItemMap, iterationByPath);
    const depth = multiSprintChildDepths.get(child.id) ?? 0;
    const externalX = columnX.get(placementPath);
    const baseSlotX = isNil(externalX) ? GROUP_PADDING : externalX - minSpanX + GROUP_PADDING;
    const slotX = baseSlotX + (depthOffsets.get(depth) ?? depth * SUB_COLUMN_STRIDE);
    placements.push({ child, path: placementPath, depth, slotX });
  }
  placements.sort((a, b) => a.depth - b.depth);
  return placements;
}

/** Render the children of a multi-sprint parent, placing them into per-sprint sub-columns. */
function renderMultiSprintChildren(
  placements: ChildPlacement[],
  groupId: string,
  spanWidth: number,
  ctx: RenderContext,
): Map<string, number> {
  const childYPositions = new Map<number, number>();
  const subColCurrentY = new Map<string, number>();

  for (const { child, path, depth, slotX } of placements) {
    const subColKey = `${path}:${depth}`;
    const slotExtent: CoordExtent = [
      [0, HEADER_HEIGHT],
      [spanWidth, Y_EXTENT_MAX],
    ];

    const childY = computeChildY(child, depth, childYPositions, subColCurrentY, subColKey);
    const childIsParent = child.children.length > 0;
    const childIsExpanded = ctx.expandedParents.has(child.id);

    if (childIsParent && childIsExpanded) {
      const dims = renderExpandedGroup(child, slotX, childY, groupId, ctx);
      childYPositions.set(child.id, childY);
      subColCurrentY.set(subColKey, childY + dims.height + NODE_GAP_Y);
    } else {
      const childDoneCount = countDoneChildren(child, ctx);
      const childNodeId = `wi-${child.id}`;
      ctx.nodeIdMap.set(child.id, childNodeId);
      ctx.nodes.push({
        id: childNodeId,
        type: BOARD_NODE_TYPES.workItem,
        position: { x: slotX, y: childY },
        parentId: groupId,
        extent: slotExtent,
        data: {
          workItem: child,
          isParent: childIsParent,
          isExpanded: false,
          isActionable: ctx.actionableSet.has(child.id),
          childCount: child.children.length,
          doneChildCount: childDoneCount,
        },
        draggable: true,
      });
      childYPositions.set(child.id, childY);
      subColCurrentY.set(subColKey, childY + NODE_HEIGHT + NODE_GAP_Y);
    }
  }

  return subColCurrentY;
}

/** Compute the Y position for a child node, aligning with predecessors if applicable. */
function computeChildY(
  child: WorkItem,
  depth: number,
  childYPositions: Map<number, number>,
  subColCurrentY: Map<string, number>,
  subColKey: string,
): number {
  if (depth > 0 && child.predecessors.length > 0) {
    let predMaxY = HEADER_HEIGHT + GROUP_PADDING;
    for (const predId of child.predecessors) {
      const predY = childYPositions.get(predId);
      if (!isNil(predY)) {
        predMaxY = Math.max(predMaxY, predY);
      }
    }
    const colY = subColCurrentY.get(subColKey) ?? HEADER_HEIGHT + GROUP_PADDING;
    return Math.max(predMaxY, colY);
  }
  return subColCurrentY.get(subColKey) ?? HEADER_HEIGHT + GROUP_PADDING;
}

/** Layout an expanded multi-sprint parent group, rendering its children and returning the group height. */
function layoutExpandedMultiSprint(
  workItem: WorkItem,
  currentY: number,
  span: MultiSprintSpan,
  doneChildCount: number,
  plan: ColumnPlan,
  iterInfo: IterationInfo,
  ctx: RenderContext,
): number {
  const directChildren = resolveWorkItemIds(workItem.children, ctx.workItemMap);

  const placements = computeChildPlacements(
    directChildren,
    ctx.workItemMap,
    iterInfo.iterationByPath,
    plan.multiSprintChildDepths,
    plan.columnX,
    span.minSpanX,
    ctx.expandedParents,
    ctx.doneStates,
  );

  let estimatedHeight = 0;
  for (const { child } of placements) {
    const m = measureChildHeight(child, ctx.workItemMap, ctx.expandedParents, ctx.doneStates);
    estimatedHeight = Math.max(estimatedHeight, m.height);
  }
  const initialGroupHeight =
    HEADER_HEIGHT + GROUP_PADDING * 2 + estimatedHeight * directChildren.length;

  const groupId = `group-${workItem.id}`;
  ctx.nodeIdMap.set(workItem.id, groupId);

  const groupNode: LayoutNode = {
    id: groupId,
    type: BOARD_NODE_TYPES.parentGroup,
    position: { x: span.minSpanX, y: currentY },
    data: {
      label: workItem.title,
      workItemId: workItem.id,
      workItemType: workItem.type,
      state: workItem.state,
      childCount: workItem.children.length,
      doneChildCount,
      width: span.spanWidth,
      height: initialGroupHeight,
      onToggleExpand: undefined,
    },
    draggable: false,
    extent: span.extent,
    style: { width: span.spanWidth, height: initialGroupHeight },
  };
  ctx.nodes.push(groupNode);

  const subColCurrentY = renderMultiSprintChildren(placements, groupId, span.spanWidth, ctx);

  let actualMaxChildBottom = 0;
  for (const y of subColCurrentY.values()) {
    actualMaxChildBottom = Math.max(actualMaxChildBottom, y);
  }
  const finalGroupHeight = actualMaxChildBottom + GROUP_PADDING;

  groupNode.data = { ...groupNode.data, height: finalGroupHeight };
  groupNode.style = { width: span.spanWidth, height: finalGroupHeight };

  return finalGroupHeight;
}

/** Layout a collapsed multi-sprint parent as a single-height node, returning its height. */
function layoutCollapsedMultiSprint(
  workItem: WorkItem,
  currentY: number,
  span: MultiSprintSpan,
  doneChildCount: number,
  ctx: RenderContext,
): number {
  const groupId = `group-${workItem.id}`;
  ctx.nodeIdMap.set(workItem.id, groupId);
  const collapsedHeight = NODE_HEIGHT;

  ctx.nodes.push({
    id: groupId,
    type: BOARD_NODE_TYPES.parentGroup,
    position: { x: span.minSpanX, y: currentY },
    data: {
      label: workItem.title,
      workItemId: workItem.id,
      workItemType: workItem.type,
      state: workItem.state,
      childCount: workItem.children.length,
      doneChildCount,
      width: span.spanWidth,
      height: collapsedHeight,
      onToggleExpand: undefined,
    },
    draggable: false,
    extent: span.extent,
    style: { width: span.spanWidth, height: collapsedHeight },
  });

  return collapsedHeight;
}

/** Advance the Y cursor for all columns spanned by a multi-sprint parent after placing it.
 *
 * Fills the entire contiguous effectiveColumn range [minC, maxC] rather than only the
 * specific sprint columns in descPaths. Without this, a gap between two
 * non-consecutive descendant sprints leaves intermediate columns at their
 * initial Y, causing another multi-sprint parent whose home sprint falls in
 * that gap to be placed at y=TOP_OFFSET and visually overlap the first parent.
 */
function advanceSpannedColumns(
  descPaths: Set<string>,
  newY: number,
  columnCurrentY: Map<number, number>,
  plan: ColumnPlan,
): void {
  let minC = Infinity;
  let maxC = -Infinity;

  for (const p of descPaths) {
    const startC = plan.sprintStartCol.get(p);
    if (startC === undefined) {
      continue;
    }
    const width = plan.sprintWidths.get(p) ?? 1;
    if (startC < minC) {
      minC = startC;
    }
    if (startC + width - 1 > maxC) {
      maxC = startC + width - 1;
    }
  }

  if (minC === Infinity) {
    return;
  }

  for (let c = minC; c <= maxC; c++) {
    const existingY = columnCurrentY.get(c) ?? TOP_OFFSET;
    columnCurrentY.set(c, Math.max(existingY, newY));
  }
}

/** Layout a regular (non-multi-sprint) work item or expanded parent, returning its height. */
function layoutRegularItem(
  workItem: WorkItem,
  colX: number,
  currentY: number,
  doneChildCount: number,
  ctx: RenderContext,
): number {
  const isParent = workItem.children.length > 0;
  const isExpanded = ctx.expandedParents.has(workItem.id);

  if (isParent && isExpanded) {
    const { height: gh } = renderExpandedGroup(workItem, colX, currentY, undefined, ctx);
    return gh;
  }

  const nodeId = `wi-${workItem.id}`;
  ctx.nodeIdMap.set(workItem.id, nodeId);
  ctx.nodes.push({
    id: nodeId,
    type: BOARD_NODE_TYPES.workItem,
    position: { x: colX, y: currentY },
    data: {
      workItem,
      isParent,
      isExpanded: false,
      isActionable: ctx.actionableSet.has(workItem.id),
      childCount: workItem.children.length,
      doneChildCount,
    },
    draggable: true,
  });
  return NODE_HEIGHT;
}

/** Walk each effective column left-to-right, placing items vertically and returning per-column Y cursors. */
function layoutAllColumns(
  plan: ColumnPlan,
  multiSprint: MultiSprintInfo,
  iterInfo: IterationInfo,
  ctx: RenderContext,
): Map<number, number> {
  const columnCurrentY = new Map<number, number>();
  for (let i = 0; i <= plan.maxColumnIndex; i++) {
    columnCurrentY.set(i, TOP_OFFSET);
  }

  for (let effectiveColumn = 0; effectiveColumn <= plan.maxColumnIndex; effectiveColumn++) {
    const colX = plan.xPositionByColumn.get(effectiveColumn) ?? SPRINT_PADDING;
    const items = plan.workItemsByColumn.get(effectiveColumn) ?? [];

    const sortedItems = [...items].sort((a, b) => {
      const typeOrderDifference = getWorkItemTypeOrder(a) - getWorkItemTypeOrder(b);
      if (typeOrderDifference !== 0) {
        return typeOrderDifference;
      }

      const aDone = ctx.doneStates.has(a.state) ? 1 : 0;
      const bDone = ctx.doneStates.has(b.state) ? 1 : 0;
      return aDone - bDone;
    });

    let currentY = columnCurrentY.get(effectiveColumn) ?? TOP_OFFSET;
    for (const workItem of sortedItems) {
      const doneChildCount = countDoneChildren(workItem, ctx);

      if (multiSprint.parentIds.has(workItem.id)) {
        const descPaths = multiSprint.paths.get(workItem.id);
        if (!descPaths) {
          continue;
        }
        const span = computeMultiSprintSpan(colX, descPaths, plan.columnX, plan.sprintWidths);

        let itemHeight: number;
        if (ctx.expandedParents.has(workItem.id)) {
          itemHeight = layoutExpandedMultiSprint(
            workItem,
            currentY,
            span,
            doneChildCount,
            plan,
            iterInfo,
            ctx,
          );
        } else {
          itemHeight = layoutCollapsedMultiSprint(workItem, currentY, span, doneChildCount, ctx);
        }

        currentY += itemHeight + NODE_GAP_Y;
        advanceSpannedColumns(descPaths, currentY, columnCurrentY, plan);
      } else {
        const itemHeight = layoutRegularItem(workItem, colX, currentY, doneChildCount, ctx);
        currentY += itemHeight + NODE_GAP_Y;
      }
    }

    columnCurrentY.set(effectiveColumn, currentY);
  }

  return columnCurrentY;
}

// --- Phase 5: Sprint dividers ---

/** Create sprint divider background nodes spanning the full board height. */
function createSprintDividers(
  iterInfo: IterationInfo,
  plan: ColumnPlan,
  columnCurrentY: Map<number, number>,
  nodes: LayoutNode[],
): void {
  let overallMaxY = TOP_OFFSET + NODE_HEIGHT * MIN_DIVIDER_HEIGHT_ROWS;
  for (const y of columnCurrentY.values()) {
    overallMaxY = Math.max(overallMaxY, y);
  }

  for (const iterPath of iterInfo.iterationPaths) {
    const startCol = plan.sprintStartCol.get(iterPath) ?? 0;
    const width = plan.sprintWidths.get(iterPath) ?? 1;
    const colStartX = plan.xPositionByColumn.get(startCol) ?? SPRINT_PADDING;
    const dividerWidth =
      MIN_COLUMN_WIDTH + (width > 1 ? (width - 1) * SUB_COLUMN_STRIDE : 0) + SPRINT_PADDING;
    const iterName = iterPath.split("\\").pop() ?? iterPath;
    const iterInfo2 = iterInfo.iterationByPath.get(iterPath);
    const isCurrent = iterPath === iterInfo.currentIterPath;

    nodes.push({
      id: `sprint-${iterPath}`,
      type: BOARD_NODE_TYPES.sprintDivider,
      position: { x: colStartX - SPRINT_PADDING / 2, y: 0 },
      data: {
        iterationPath: iterPath,
        label: iterName,
        startDate: iterInfo2?.start_date ?? null,
        finishDate: iterInfo2?.finish_date ?? null,
        height: overallMaxY + SPRINT_PADDING,
        width: dividerWidth,
        isCurrent,
      },
      draggable: false,
      style: { zIndex: -1 },
    });
  }
}

// --- Phase 6: Build edges ---

/** Create ReactFlow edges for all predecessor→successor dependency relations. */
function buildDependencyEdges(
  workItems: WorkItem[],
  workItemMap: Map<number, WorkItem>,
  nodeIdMap: NodeIdMap,
  edges: Edge[],
): void {
  const seenEdges = new Set<string>();
  for (const workItem of workItems) {
    for (const succId of workItem.successors) {
      if (workItemMap.has(succId)) {
        const edgeId = `edge-${workItem.id}-${succId}`;
        if (seenEdges.has(edgeId)) {
          continue;
        }
        seenEdges.add(edgeId);
        const sourceId = nodeIdMap.get(workItem.id) ?? `wi-${workItem.id}`;
        const targetId = nodeIdMap.get(succId) ?? `wi-${succId}`;
        edges.push({
          id: edgeId,
          source: sourceId,
          target: targetId,
          type: "dependency",
          zIndex: 10,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#000" },
        });
      }
    }
  }
}

// --- Main entry point ---

export function buildGraphLayout(boardData: BoardData, expandedParents: Set<number>): LayoutResult {
  const { work_items, iterations } = boardData;
  const nodes: LayoutNode[] = [];
  const edges: Edge[] = [];
  const nodeIdMap: NodeIdMap = new Map();

  if (work_items.length === 0) {
    const sortedIterations = [...iterations].sort((a, b) => {
      if (a.start_date && b.start_date) {
        return a.start_date.localeCompare(b.start_date);
      }
      return a.path.localeCompare(b.path);
    });

    sortedIterations.forEach((iteration, index) => {
      nodes.push({
        id: `sprint-${iteration.path}`,
        type: BOARD_NODE_TYPES.sprintDivider,
        position: { x: index * (MIN_COLUMN_WIDTH + NODE_GAP_X) + SPRINT_PADDING / 2, y: 0 },
        data: {
          iterationPath: iteration.path,
          label: iteration.path.split("\\").pop() ?? iteration.path,
          startDate: iteration.start_date,
          finishDate: iteration.finish_date,
          height: TOP_OFFSET + NODE_HEIGHT * MIN_DIVIDER_HEIGHT_ROWS + SPRINT_PADDING,
          width: MIN_COLUMN_WIDTH + SPRINT_PADDING,
          isCurrent: false,
        },
        draggable: false,
        style: { zIndex: -1 },
      });
    });

    return { nodes, edges };
  }

  const workItemMap = new Map(work_items.map((workItem) => [workItem.id, workItem]));
  const doneStates = DONE_STATES;
  const actionableSet = computeActionableSet(work_items);
  const ctx: RenderContext = {
    nodes,
    nodeIdMap,
    workItemMap,
    expandedParents,
    doneStates,
    actionableSet,
  };

  const multiSprint = identifyMultiSprintParents(work_items, workItemMap);
  const iterInfo = buildIterationInfo(work_items, iterations, multiSprint, workItemMap);
  const plan = buildColumnPlan(iterInfo, multiSprint, workItemMap, expandedParents, doneStates);
  const columnCurrentY = layoutAllColumns(plan, multiSprint, iterInfo, ctx);

  createSprintDividers(iterInfo, plan, columnCurrentY, nodes);
  buildDependencyEdges(work_items, workItemMap, nodeIdMap, edges);

  const { positions: nodePositions, parentMap } = buildNodePositions(nodes);
  const routedEdges = assignLaneOffsets(edges, nodePositions, parentMap);

  return { nodes, edges: routedEdges };
}

/** Builds a NodePosition map resolving child nodes to absolute coordinates. */
export function buildNodePositions(
  nodes: readonly {
    id: string;
    position: Point;
    parentId?: string;
    style?: { width?: string | number; height?: string | number };
    measured?: { width?: number; height?: number };
    type?: string;
  }[],
): { positions: Map<string, NodePosition>; parentMap: Map<string, string> } {
  const nodeById = new Map<string, (typeof nodes)[number]>();
  nodes.forEach((node) => nodeById.set(node.id, node));

  const positions = new Map<string, NodePosition>();
  const parentMap = new Map<string, string>();
  nodes.forEach((node) => {
    let absX = node.position.x;
    let absY = node.position.y;
    if (node.parentId) {
      parentMap.set(node.id, node.parentId);
    }
    // Walk up the full ancestor chain to resolve absolute coordinates
    let current = node.parentId ? nodeById.get(node.parentId) : undefined;
    while (current) {
      absX += current.position.x;
      absY += current.position.y;
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }

    const defaultWidth = node.type === BOARD_NODE_TYPES.workItem ? CHILD_WIDTH : SUB_COLUMN_WIDTH;
    let width = defaultWidth;
    if (node.style?.width !== undefined) {
      width = Number(node.style.width);
    } else if (node.measured?.width !== undefined) {
      width = node.measured.width;
    }

    let height = NODE_HEIGHT;
    if (node.style?.height !== undefined) {
      height = Number(node.style.height);
    } else if (node.measured?.height !== undefined) {
      height = node.measured.height;
    }
    const nodeType = isBoardNodeType(node.type) ? node.type : undefined;
    positions.set(node.id, { x: absX, y: absY, width, height, type: nodeType });
  });
  return { positions, parentMap };
}
