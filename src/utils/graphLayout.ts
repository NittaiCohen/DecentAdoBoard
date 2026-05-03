import type { Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { isNil } from "lodash-es";
import type { BoardData, Iteration, WorkItem } from "../types";
import type { WorkItemNodeData } from "../components/WorkItemNode";
import type { SprintDividerData } from "../components/SprintDivider";
import type { ParentGroupData } from "../components/ParentGroup";
import { computeActionableSet } from "./actionable";

export const NODE_HEIGHT = 80;
const NODE_GAP_X = 60;
export const NODE_GAP_Y = 20;
const SPRINT_PADDING = 40;
const MIN_COLUMN_WIDTH = 1200;
const TOP_OFFSET = 60;
const SUB_COLUMN_WIDTH = 280;
const SUB_COLUMN_STRIDE = SUB_COLUMN_WIDTH + NODE_GAP_X;

type AnyNodeData = WorkItemNodeData | SprintDividerData | ParentGroupData | DragGhostData;

export interface DragGhostData extends Record<string, unknown> {
  width: number;
  height: number;
}

type CoordExtent = [[number, number], [number, number]];

interface LayoutNode {
  id: string;
  type: string;
  position: { x: number; y: number };
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

type NodeIdMap = Map<number, string>;

/**
 * Compute dependency depth for a set of items using Kahn's algorithm.
 * Returns a map of item ID → depth (0 = no predecessors in the set).
 */
function computeLocalInDegrees(items: WorkItem[], itemIds: Set<number>): Map<number, number> {
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

function computeDependencyDepths(
  items: WorkItem[],
  workItemMap: Map<number, WorkItem>,
): { depths: Map<number, number>; maxDepth: number } {
  const itemIds = new Set(items.map((item) => item.id));
  const localInDeg = computeLocalInDegrees(items, itemIds);

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

interface RenderContext {
  nodes: LayoutNode[];
  nodeIdMap: NodeIdMap;
  workItemMap: Map<number, WorkItem>;
  expandedParents: Set<number>;
  doneStates: Set<string>;
  actionableSet: Set<number>;
}

function countDoneChildren(workItem: WorkItem, ctx: RenderContext): number {
  return workItem.children.filter((childId) => {
    const child = ctx.workItemMap.get(childId);
    return child && ctx.doneStates.has(child.state);
  }).length;
}

function renderChildNodes(childItems: WorkItem[], groupId: string, ctx: RenderContext): number {
  let childY = HEADER_HEIGHT + GROUP_PADDING;
  for (const child of childItems) {
    const childIsParent = child.children.length > 0;
    const childIsExpanded = ctx.expandedParents.has(child.id);

    if (childIsParent && childIsExpanded) {
      const dims = renderExpandedGroup(child, GROUP_PADDING, childY, groupId, ctx);
      childY += dims.height + NODE_GAP_Y;
    } else {
      const childDoneCount = countDoneChildren(child, ctx);
      const childNodeId = `wi-${child.id}`;
      ctx.nodeIdMap.set(child.id, childNodeId);
      ctx.nodes.push({
        id: childNodeId,
        type: "workItem",
        position: { x: GROUP_PADDING, y: childY },
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
      childY += NODE_HEIGHT + NODE_GAP_Y;
    }
  }
  return childY;
}

/**
 * Recursively render an expanded parent group (single-column).
 */
function measureGroupDimensions(
  childItems: WorkItem[],
  ctx: RenderContext,
): { width: number; height: number } {
  let childAreaHeight = 0;
  let childMaxWidth = CHILD_WIDTH;
  for (const child of childItems) {
    const m = measureChildHeight(child, ctx.workItemMap, ctx.expandedParents, ctx.doneStates);
    childAreaHeight += m.height + NODE_GAP_Y;
    childMaxWidth = Math.max(childMaxWidth, m.width);
  }
  childAreaHeight -= NODE_GAP_Y;
  return {
    width: childMaxWidth + GROUP_PADDING * 2,
    height: HEADER_HEIGHT + GROUP_PADDING * 2 + childAreaHeight,
  };
}

function renderExpandedGroup(
  workItem: WorkItem,
  x: number,
  y: number,
  reactFlowParentId: string | undefined,
  ctx: RenderContext,
  columnExtent?: CoordExtent,
): { width: number; height: number } {
  const childItems = workItem.children
    .map((childId) => ctx.workItemMap.get(childId))
    .filter((childWorkItem): childWorkItem is WorkItem => childWorkItem !== undefined);

  const { width: groupWidth, height: groupHeight } = measureGroupDimensions(childItems, ctx);
  const doneChildCount = countDoneChildren(workItem, ctx);

  const groupId = `group-${workItem.id}`;
  ctx.nodeIdMap.set(workItem.id, groupId);

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
    draggable: !MULTI_SPRINT_TYPES.has(workItem.work_item_type),
    style: { width: groupWidth, height: groupHeight },
  };
  if (reactFlowParentId) {
    node.parentId = reactFlowParentId;
    node.extent = "parent";
  } else if (columnExtent) {
    node.extent = columnExtent;
  }
  ctx.nodes.push(node);

  renderChildNodes(childItems, groupId, ctx);

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
  itemEffCol: Map<number, number>;
  effColumnX: Map<number, number>;
  effColumnGroups: Map<number, WorkItem[]>;
  columnX: Map<string, number>;
  maxEffCol: number;
  multiSprintChildDepths: Map<number, number>;
}

// --- Phase 1: Identify multi-sprint parents ---

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
    if (!MULTI_SPRINT_TYPES.has(workItem.work_item_type)) {
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

function groupItemsBySprint(
  workItems: WorkItem[],
  multiSprint: MultiSprintInfo,
  workItemMap: Map<number, WorkItem>,
  iterationByPath: Map<string, Iteration>,
): Map<string, WorkItem[]> {
  const groups = new Map<string, WorkItem[]>();

  for (const workItem of workItems) {
    if (multiSprint.descendantIds.has(workItem.id)) {
      continue;
    }
    if (
      workItem.parent_id &&
      workItemMap.has(workItem.parent_id) &&
      !multiSprint.parentIds.has(workItem.id)
    ) {
      continue;
    }

    let homeCol: string;
    if (multiSprint.parentIds.has(workItem.id)) {
      const descPaths = multiSprint.paths.get(workItem.id);
      if (!descPaths) {
        continue;
      }
      homeCol = findEarliestPath(descPaths, iterationByPath);
    } else {
      homeCol = workItem.iteration_path;
    }

    const group = groups.get(homeCol) ?? [];
    group.push(workItem);
    groups.set(homeCol, group);
  }

  return groups;
}

// --- Phase 3: Compute effective columns ---

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
    const directChildren = parent.children
      .map((childId) => workItemMap.get(childId))
      .filter((child): child is WorkItem => child !== undefined);

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

function buildColumnPlan(
  iterInfo: IterationInfo,
  multiSprint: MultiSprintInfo,
  workItemMap: Map<number, WorkItem>,
): ColumnPlan {
  const { withinSprintDepth, sprintWidths } = computeSprintDepths(iterInfo, workItemMap);
  const multiSprintChildDepths = computeMultiSprintChildDepths(
    multiSprint,
    workItemMap,
    iterInfo.iterationByPath,
    sprintWidths,
  );

  const sprintStartCol = new Map<string, number>();
  let effColStart = 0;
  for (const path of iterInfo.iterationPaths) {
    sprintStartCol.set(path, effColStart);
    effColStart += sprintWidths.get(path) ?? 1;
  }

  const itemEffCol = new Map<number, number>();
  for (const [iterPath, items] of iterInfo.iterationGroups) {
    const base = sprintStartCol.get(iterPath) ?? 0;
    for (const item of items) {
      const depth = withinSprintDepth.get(item.id) ?? 0;
      itemEffCol.set(item.id, base + depth);
    }
  }

  enforceSuccessorOrdering(itemEffCol, workItemMap);

  let maxEffCol = effColStart - 1;
  for (const col of itemEffCol.values()) {
    maxEffCol = Math.max(maxEffCol, col);
  }

  const effColumnX = buildEffColumnXPositions(
    iterInfo.iterationPaths,
    sprintStartCol,
    sprintWidths,
  );

  const effColumnGroups = new Map<number, WorkItem[]>();
  for (const [id, col] of itemEffCol) {
    const item = workItemMap.get(id);
    if (!item) {
      continue;
    }
    const group = effColumnGroups.get(col) ?? [];
    group.push(item);
    effColumnGroups.set(col, group);
  }

  const columnX = new Map<string, number>();
  for (const path of iterInfo.iterationPaths) {
    const startCol = sprintStartCol.get(path) ?? 0;
    const x = effColumnX.get(startCol);
    if (!isNil(x)) {
      columnX.set(path, x);
    }
  }

  return {
    sprintWidths,
    sprintStartCol,
    itemEffCol,
    effColumnX,
    effColumnGroups,
    columnX,
    maxEffCol,
    multiSprintChildDepths,
  };
}

function enforceSuccessorOrdering(
  itemEffCol: Map<number, number>,
  workItemMap: Map<number, WorkItem>,
): void {
  const allColumnItemIds = new Set(itemEffCol.keys());
  let crossShifted = true;
  while (crossShifted) {
    crossShifted = false;
    for (const id of allColumnItemIds) {
      const item = workItemMap.get(id);
      const myCol = itemEffCol.get(id);
      if (!item || isNil(myCol)) {
        continue;
      }
      for (const succId of item.successors) {
        const succCol = itemEffCol.get(succId);
        if (!isNil(succCol) && succCol <= myCol) {
          itemEffCol.set(succId, myCol + 1);
          crossShifted = true;
        }
      }
    }
  }
}

function buildEffColumnXPositions(
  iterationPaths: string[],
  sprintStartCol: Map<string, number>,
  sprintWidths: Map<string, number>,
): Map<number, number> {
  const effColumnX = new Map<number, number>();
  let sprintBaseX = SPRINT_PADDING;
  for (const path of iterationPaths) {
    const startCol = sprintStartCol.get(path) ?? 0;
    const width = sprintWidths.get(path) ?? 1;
    for (let sub = 0; sub < width; sub++) {
      effColumnX.set(startCol + sub, sprintBaseX + sub * SUB_COLUMN_STRIDE);
    }
    sprintBaseX +=
      MIN_COLUMN_WIDTH + (width > 1 ? (width - 1) * SUB_COLUMN_STRIDE : 0) + NODE_GAP_X;
  }
  return effColumnX;
}

// --- Phase 4: Layout items per column ---

interface MultiSprintSpan {
  minSpanX: number;
  spanWidth: number;
  extent: CoordExtent;
}

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

function computeChildPlacements(
  directChildren: WorkItem[],
  workItemMap: Map<number, WorkItem>,
  iterationByPath: Map<string, Iteration>,
  multiSprintChildDepths: Map<number, number>,
  columnX: Map<string, number>,
  minSpanX: number,
): ChildPlacement[] {
  const placements: ChildPlacement[] = [];
  for (const child of directChildren) {
    let placementPath = child.iteration_path;
    if (child.children.length > 0) {
      const childDescPaths = collectDescendantIterPaths(child, workItemMap);
      placementPath = findEarliestPath(childDescPaths, iterationByPath);
    }
    const depth = multiSprintChildDepths.get(child.id) ?? 0;
    const externalX = columnX.get(placementPath);
    const baseSlotX = isNil(externalX) ? GROUP_PADDING : externalX - minSpanX + GROUP_PADDING;
    const slotX = baseSlotX + depth * SUB_COLUMN_STRIDE;
    placements.push({ child, path: placementPath, depth, slotX });
  }
  placements.sort((a, b) => a.depth - b.depth);
  return placements;
}

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
        type: "workItem",
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

function layoutExpandedMultiSprint(
  workItem: WorkItem,
  currentY: number,
  span: MultiSprintSpan,
  doneChildCount: number,
  plan: ColumnPlan,
  iterInfo: IterationInfo,
  ctx: RenderContext,
): number {
  const directChildren = workItem.children
    .map((childId) => ctx.workItemMap.get(childId))
    .filter((childWorkItem): childWorkItem is WorkItem => childWorkItem !== undefined);

  const placements = computeChildPlacements(
    directChildren,
    ctx.workItemMap,
    iterInfo.iterationByPath,
    plan.multiSprintChildDepths,
    plan.columnX,
    span.minSpanX,
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
    type: "parentGroup",
    position: { x: span.minSpanX, y: currentY },
    data: {
      label: workItem.title,
      workItemId: workItem.id,
      workItemType: workItem.work_item_type,
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
    type: "parentGroup",
    position: { x: span.minSpanX, y: currentY },
    data: {
      label: workItem.title,
      workItemId: workItem.id,
      workItemType: workItem.work_item_type,
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

function advanceSpannedColumns(
  descPaths: Set<string>,
  newY: number,
  columnCurrentY: Map<number, number>,
  plan: ColumnPlan,
): void {
  for (const p of descPaths) {
    const startC = plan.sprintStartCol.get(p) ?? 0;
    const width = plan.sprintWidths.get(p) ?? 1;
    for (let c = startC; c < startC + width; c++) {
      const existingY = columnCurrentY.get(c) ?? TOP_OFFSET;
      columnCurrentY.set(c, Math.max(existingY, newY));
    }
  }
}

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
  const extentBounds: CoordExtent = [
    [colX, TOP_OFFSET],
    [colX + MIN_COLUMN_WIDTH, Y_EXTENT_MAX],
  ];
  ctx.nodes.push({
    id: nodeId,
    type: "workItem",
    position: { x: colX, y: currentY },
    extent: extentBounds,
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

function layoutAllColumns(
  plan: ColumnPlan,
  multiSprint: MultiSprintInfo,
  iterInfo: IterationInfo,
  ctx: RenderContext,
): Map<number, number> {
  const columnCurrentY = new Map<number, number>();
  for (let i = 0; i <= plan.maxEffCol; i++) {
    columnCurrentY.set(i, TOP_OFFSET);
  }

  for (let effCol = 0; effCol <= plan.maxEffCol; effCol++) {
    const colX = plan.effColumnX.get(effCol) ?? SPRINT_PADDING;
    const items = plan.effColumnGroups.get(effCol) ?? [];

    const sortedItems = [...items].sort((a, b) => {
      const aDone = ctx.doneStates.has(a.state) ? 1 : 0;
      const bDone = ctx.doneStates.has(b.state) ? 1 : 0;
      return aDone - bDone;
    });

    let currentY = columnCurrentY.get(effCol) ?? TOP_OFFSET;
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

    columnCurrentY.set(effCol, currentY);
  }

  return columnCurrentY;
}

// --- Phase 5: Sprint dividers ---

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
    const colStartX = plan.effColumnX.get(startCol) ?? SPRINT_PADDING;
    const dividerWidth =
      MIN_COLUMN_WIDTH + (width > 1 ? (width - 1) * SUB_COLUMN_STRIDE : 0) + SPRINT_PADDING;
    const iterName = iterPath.split("\\").pop() ?? iterPath;
    const iterInfo2 = iterInfo.iterationByPath.get(iterPath);
    const isCurrent = iterPath === iterInfo.currentIterPath;

    nodes.push({
      id: `sprint-${iterPath}`,
      type: "sprintDivider",
      position: { x: colStartX - SPRINT_PADDING / 2, y: 0 },
      data: {
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

function buildDependencyEdges(
  workItems: WorkItem[],
  workItemMap: Map<number, WorkItem>,
  nodeIdMap: NodeIdMap,
  edges: Edge[],
): void {
  for (const workItem of workItems) {
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
}

// --- Main entry point ---

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
  const plan = buildColumnPlan(iterInfo, multiSprint, workItemMap);
  const columnCurrentY = layoutAllColumns(plan, multiSprint, iterInfo, ctx);

  createSprintDividers(iterInfo, plan, columnCurrentY, nodes);
  buildDependencyEdges(work_items, workItemMap, nodeIdMap, edges);

  return { nodes, edges };
}
