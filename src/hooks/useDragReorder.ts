import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import { isNil } from "lodash-es";
import type { Node } from "@xyflow/react";
import type { Point, WorkItem } from "../types";
import { BOARD_NODE_TYPES } from "../types/graph";
import { NODE_HEIGHT, NODE_GAP_Y, SPRINT_PADDING } from "../utils/graphLayout";
import type { IterationChange, ReversibleOperation } from "../utils/reversibleOperations";
import { capturePositions } from "../utils/reversibleOperations";

const SUB_COLUMN_WIDTH_FALLBACK = 280;
const GHOST_NODE_ID = "__drag-ghost__";
const WORK_ITEM_NODE_PREFIX = "wi-";
const GROUP_NODE_PREFIX = "group-";

export interface SiblingInfo {
  id: string;
  origY: number;
  height: number;
}

export interface DragState {
  draggedId: string;
  draggedParent: string | undefined;
  draggedOrigX: number;
  draggedOrigY: number;
  columnX: number;
  draggedHeight: number;
  draggedWidth: number;
  siblings: SiblingInfo[];
  siblingById: Map<string, SiblingInfo>;
  baseY: number;
  successorIds: Set<string>;
  successorOriginalX: Map<string, number>;
  xLocked: boolean;
  sprintRanges?: SprintRange[];
  lastInsertIdx: number;
  lastSlotPositions: Map<string, number>;
}

interface SprintRange {
  iterationPath?: string;
  left: number;
  right: number;
  dropX?: number;
  dropY?: number;
}

interface FinalizeNodeOptions {
  state: DragState;
  slotPositions: Map<string, number>;
  deltaX: number;
  finalX: number;
  ghostY: number;
}

// --- Pure helpers ---

export function extractWorkItemId(nodeId: string): number | undefined {
  if (nodeId.startsWith(WORK_ITEM_NODE_PREFIX)) {
    const rawId = nodeId.slice(WORK_ITEM_NODE_PREFIX.length);
    return rawId === "" ? Number.NaN : Number(rawId);
  }
  if (nodeId.startsWith(GROUP_NODE_PREFIX)) {
    const rawId = nodeId.slice(GROUP_NODE_PREFIX.length);
    return rawId === "" ? Number.NaN : Number(rawId);
  }
  return undefined;
}

export function collectSuccessorChain(
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

function buildSprintRanges(nodes: Node[]): SprintRange[] {
  const sprintRanges = nodes
    .filter((node) => node.type === BOARD_NODE_TYPES.sprintDivider)
    .map((node) => ({
      iterationPath: String(node.data.iterationPath),
      left: node.position.x,
      right: node.position.x + Number(node.data.width ?? 0),
      dropX: node.position.x + SPRINT_PADDING / 2,
      dropY: NODE_HEIGHT + NODE_GAP_Y,
    }))
    .filter((range) => range.right > range.left)
    .sort((first, second) => first.left - second.left);

  const eligibleNodes = nodes
    .filter((node) => !node.parentId)
    .filter(
      (node) =>
        node.type === BOARD_NODE_TYPES.workItem || node.type === BOARD_NODE_TYPES.parentGroup,
    );

  for (const node of eligibleNodes) {
    const nodeWidth = node.measured?.width ?? Number(node.style?.width ?? 0);
    const nodeHeight = node.measured?.height ?? Number(node.style?.height ?? NODE_HEIGHT);
    const sprintIndex = findSprintIndex(node.position.x + nodeWidth / 2, sprintRanges);
    const sprintRange = sprintRanges[sprintIndex];
    if (!sprintRange) {
      continue;
    }

    sprintRange.dropX = Math.min(sprintRange.dropX ?? node.position.x, node.position.x);
    sprintRange.dropY = Math.max(
      sprintRange.dropY ?? NODE_HEIGHT + NODE_GAP_Y,
      node.position.y + nodeHeight + NODE_GAP_Y,
    );
  }

  return sprintRanges;
}

function findSprintIndex(x: number, sprintRanges: SprintRange[]): number {
  return sprintRanges.findIndex((range) => x >= range.left && x <= range.right);
}

function findIterationPath(x: number, sprintRanges: SprintRange[]): string | undefined {
  const sprintIndex = findSprintIndex(x, sprintRanges);
  return sprintRanges[sprintIndex]?.iterationPath;
}

export function constrainDragPosition(state: DragState, position: Point): Point {
  const sprintRanges = state.sprintRanges ?? [];
  const originalSprintIndex = findSprintIndex(state.draggedOrigX, sprintRanges);
  const currentSprintIndex = findSprintIndex(position.x, sprintRanges);
  const targetRange = sprintRanges[currentSprintIndex];
  const isInAnotherSprint =
    originalSprintIndex >= 0 &&
    currentSprintIndex >= 0 &&
    originalSprintIndex !== currentSprintIndex;
  const x = isInAnotherSprint ? (targetRange?.dropX ?? position.x) : state.draggedOrigX;
  const y = isInAnotherSprint ? (targetRange?.dropY ?? state.draggedOrigY) : state.draggedOrigY;

  return { x, y };
}

/** Build the initial drag state from current nodes and the dragged node */
export function buildDragStartState(
  prev: Node[],
  draggedNode: Node,
  wiMap: Map<number, WorkItem>,
): DragState {
  const dragHeight =
    draggedNode.measured?.height ??
    (draggedNode.style?.height ? Number(draggedNode.style.height) : NODE_HEIGHT);
  const dragWidth =
    draggedNode.measured?.width ??
    (draggedNode.style?.width ? Number(draggedNode.style.width) : SUB_COLUMN_WIDTH_FALLBACK);
  const dragX = draggedNode.position.x;
  const dragParent = draggedNode.parentId;

  const nodeMap = new Map<string, Node>();
  for (const node of prev) {
    nodeMap.set(node.id, node);
  }

  const workItemId = extractWorkItemId(draggedNode.id);
  const draggedWorkItem = isNil(workItemId) ? undefined : wiMap.get(workItemId);
  const sprintRanges = buildSprintRanges(prev);

  const successorIds = draggedWorkItem
    ? collectSuccessorChain(draggedWorkItem.id, wiMap, nodeMap)
    : new Set<string>();
  const successorOriginalX = new Map<string, number>();
  for (const successorId of successorIds) {
    const successorNode = nodeMap.get(successorId);
    if (successorNode) {
      successorOriginalX.set(successorId, successorNode.position.x);
    }
  }

  const siblings = buildSiblingList(prev, draggedNode, dragX, dragParent);
  const siblingById = new Map<string, SiblingInfo>();
  for (const s of siblings) {
    siblingById.set(s.id, s);
  }

  // Remove same-column successors from the horizontal-chain set;
  // they'll be handled as siblings for vertical slot logic instead.
  for (const siblingId of siblingById.keys()) {
    successorIds.delete(siblingId);
    successorOriginalX.delete(siblingId);
  }

  const allYs = [draggedNode.position.y, ...siblings.map((s) => s.origY)];
  const baseY = Math.min(...allYs);

  const columnX = findTargetColumnX(prev, draggedNode, dragX, dragParent);

  return {
    draggedId: draggedNode.id,
    draggedParent: dragParent,
    draggedOrigX: dragX,
    draggedOrigY: draggedNode.position.y,
    columnX,
    draggedHeight: dragHeight,
    draggedWidth: dragWidth,
    siblings,
    siblingById,
    baseY,
    successorIds,
    successorOriginalX,
    xLocked: false,
    sprintRanges,
    lastInsertIdx: -1,
    lastSlotPositions: new Map(),
  };
}

/** Build a sorted list of sibling nodes in the same column as the dragged node. */
function buildSiblingList(
  prev: Node[],
  draggedNode: Node,
  dragX: number,
  dragParent: string | undefined,
): SiblingInfo[] {
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

  const targetColumnX = findTargetColumnX(prev, draggedNode, dragX, dragParent);
  const columnThreshold = SUB_COLUMN_WIDTH_FALLBACK;

  const siblings: SiblingInfo[] = candidates
    .filter((c) => Math.abs(c.x - targetColumnX) < columnThreshold)
    .map(({ id, origY, height }) => ({ id, origY, height }));
  siblings.sort((a, b) => a.origY - b.origY);
  return siblings;
}

/** Find the X position of the column containing the dragged node. */
function findTargetColumnX(
  prev: Node[],
  draggedNode: Node,
  dragX: number,
  dragParent: string | undefined,
): number {
  const candidates: Array<{ x: number }> = [];
  for (const node of prev) {
    if (node.id === draggedNode.id || !node.draggable || node.parentId !== dragParent) {
      continue;
    }
    candidates.push({ x: node.position.x });
  }

  if (candidates.length === 0) {
    return dragX;
  }

  const columnThreshold = SUB_COLUMN_WIDTH_FALLBACK;
  const columns: Array<{ x: number; count: number }> = [];
  for (const candidate of candidates) {
    const existingColumn = columns.find((col) => Math.abs(col.x - candidate.x) < columnThreshold);
    if (existingColumn) {
      existingColumn.count++;
    } else {
      columns.push({ x: candidate.x, count: 1 });
    }
  }

  // Prefer the column that contains the dragged node's X position
  const dragColumn = columns.find((col) => Math.abs(col.x - dragX) < columnThreshold);
  if (dragColumn) {
    return dragColumn.x;
  }

  // No column contains the dragged node — use dragX so siblings filter correctly
  return dragX;
}

/** Compute insert index for dragged node among siblings */
export function computeInsertIndex(state: DragState, draggedNode: Node): number {
  const currentPositions = state.lastSlotPositions;
  const dragTop = draggedNode.position.y;
  const dragBottom = dragTop + state.draggedHeight;

  if (state.lastInsertIdx < 0) {
    const dragCenterY = dragTop + state.draggedHeight / 2;
    for (let i = 0; i < state.siblings.length; i++) {
      const sibling = state.siblings[i];
      const sibY = currentPositions.get(sibling.id) ?? sibling.origY;
      const sibCenterY = sibY + sibling.height / 2;
      if (dragCenterY < sibCenterY) {
        return i;
      }
    }
    return state.siblings.length;
  }

  let insertIdx = state.lastInsertIdx;
  const prevInsertIdx = insertIdx;

  while (insertIdx > 0) {
    const sibling = state.siblings[insertIdx - 1];
    const sibY = currentPositions.get(sibling.id) ?? sibling.origY;
    const sibBottom = sibY + sibling.height;
    const overlapTop = Math.max(0, sibBottom - dragTop);
    if (overlapTop > sibling.height / 2) {
      insertIdx--;
    } else {
      break;
    }
  }

  if (insertIdx === prevInsertIdx) {
    while (insertIdx < state.siblings.length) {
      const sibling = state.siblings[insertIdx];
      const sibY = currentPositions.get(sibling.id) ?? sibling.origY;
      const overlapBottom = Math.max(0, dragBottom - sibY);
      if (overlapBottom > sibling.height / 2) {
        insertIdx++;
      } else {
        break;
      }
    }
  }

  return insertIdx;
}

/** Build slot Y positions for siblings given an insert index */
export function buildSlotPositions(
  state: DragState,
  insertIdx: number,
): { slotPositions: Map<string, number>; ghostY: number } {
  const slotPositions = new Map<string, number>();
  let ghostY = state.baseY;
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

  return { slotPositions, ghostY };
}

/** Apply drag frame updates to a single node */
/** Apply per-frame position updates to a single node during an active drag. */
function applyDragFrame(
  node: Node,
  state: DragState,
  slotPositions: Map<string, number>,
  ghostY: number,
  deltaX: number,
): Node {
  if (node.id === GHOST_NODE_ID) {
    const ghostX = state.xLocked ? state.draggedOrigX : state.draggedOrigX + deltaX;
    return { ...node, position: { x: ghostX, y: ghostY } };
  }
  if (node.id === state.draggedId) {
    return node;
  }
  // Siblings take priority: same-column successors should reorder vertically, not shift horizontally
  const siblingInfo = state.siblingById.get(node.id);
  if (siblingInfo) {
    const slotY = slotPositions.get(node.id);
    const targetY = slotY ?? siblingInfo.origY;
    return { ...node, position: { x: node.position.x, y: targetY } };
  }
  const successorOrigX = state.successorOriginalX.get(node.id);
  if (!isNil(successorOrigX) && deltaX !== 0) {
    return { ...node, position: { x: successorOrigX + deltaX, y: node.position.y } };
  }
  return node;
}

/** Compute the final position for a node after drag-stop */
function finalizeNodePosition<T extends Node>(node: T, options: FinalizeNodeOptions): T {
  const { state, slotPositions, deltaX, finalX, ghostY } = options;

  if (node.id === state.draggedId) {
    return { ...node, position: { x: finalX, y: ghostY }, className: undefined };
  }
  // Siblings take priority: same-column successors should reorder vertically, not shift horizontally
  const siblingInfo = state.siblingById.get(node.id);
  if (siblingInfo) {
    const slotY = slotPositions.get(node.id);
    const targetY = slotY ?? siblingInfo.origY;
    return { ...node, position: { x: node.position.x, y: targetY }, className: undefined };
  }

  const successorOrigX = state.successorOriginalX.get(node.id);
  if (!isNil(successorOrigX) && deltaX !== 0) {
    return {
      ...node,
      position: { x: successorOrigX + deltaX, y: node.position.y },
      className: undefined,
    };
  }

  return node.className ? { ...node, className: undefined } : node;
}

// --- Callback helpers ---

export function buildDragStartNodes(prev: Node[], state: DragState, draggedNode: Node): Node[] {
  const ghostNode = {
    id: GHOST_NODE_ID,
    type: BOARD_NODE_TYPES.dragGhost,
    position: { ...draggedNode.position },
    parentId: state.draggedParent,
    data: { width: state.draggedWidth, height: state.draggedHeight },
    draggable: false,
    selectable: false,
    focusable: false,
    className: "transition-[transform] duration-200 ease-out",
  };

  return [
    ...prev.map((node) => {
      if (state.siblingById.has(node.id) || state.successorIds.has(node.id)) {
        return { ...node, className: "transition-[transform] duration-200 ease-out" };
      }
      return node;
    }),
    ghostNode,
  ];
}

/** Compute the insert index, slot positions, ghost Y, and X delta for the current drag frame. */
function computeDragFrameState(
  state: DragState,
  draggedNode: Node,
): { slotPositions: Map<string, number>; ghostY: number; deltaX: number } {
  if (state.sprintRanges !== undefined) {
    const deltaX = draggedNode.position.x - state.draggedOrigX;
    return {
      slotPositions: new Map(),
      ghostY: draggedNode.position.y,
      deltaX,
    };
  }

  const xDrift = Math.abs(draggedNode.position.x - state.columnX);
  const inOriginalColumn = xDrift < SUB_COLUMN_WIDTH_FALLBACK;

  if (!inOriginalColumn && state.lastInsertIdx >= 0) {
    state.lastInsertIdx = -1;
    state.lastSlotPositions = new Map();
  }

  let slotPositions = new Map<string, number>();
  let ghostY = draggedNode.position.y;

  if (inOriginalColumn) {
    const insertIdx = computeInsertIndex(state, draggedNode);
    const slots = buildSlotPositions(state, insertIdx);
    slotPositions = slots.slotPositions;
    ghostY = slots.ghostY;
    state.lastInsertIdx = insertIdx;
    state.lastSlotPositions = slotPositions;
  }

  const deltaX = state.xLocked ? 0 : draggedNode.position.x - state.draggedOrigX;
  return { slotPositions, ghostY, deltaX };
}

export function buildDragStopNodes(
  prev: Node[],
  state: DragState | null,
  draggedNode: Node,
): Node[] {
  if (!state) {
    return prev
      .filter((node) => node.id !== GHOST_NODE_ID)
      .map((node) => (node.className ? { ...node, className: undefined } : node));
  }

  const constrainedPosition = constrainDragPosition(state, draggedNode.position);
  const finalDraggedNode = { ...draggedNode, position: constrainedPosition };
  const xDrift = Math.abs(finalDraggedNode.position.x - state.columnX);
  const inOriginalColumn = xDrift < SUB_COLUMN_WIDTH_FALLBACK;

  let slotPositions = new Map<string, number>();
  let ghostY = finalDraggedNode.position.y;

  if (state.sprintRanges === undefined && inOriginalColumn) {
    const insertIdx = state.lastInsertIdx >= 0 ? state.lastInsertIdx : state.siblings.length;
    const slots = buildSlotPositions(state, insertIdx);
    slotPositions = slots.slotPositions;
    ghostY = slots.ghostY;
  }

  const finalX = state.xLocked ? state.draggedOrigX : finalDraggedNode.position.x;
  const deltaX = state.xLocked ? 0 : finalDraggedNode.position.x - state.draggedOrigX;

  const finalizeOptions: FinalizeNodeOptions = { state, slotPositions, deltaX, finalX, ghostY };
  return prev
    .filter((node) => node.id !== GHOST_NODE_ID)
    .map((node) => finalizeNodePosition(node, finalizeOptions));
}

export function getIterationChanges(
  draggedNode: Node,
  state: DragState | null,
  wiMap: Map<number, WorkItem>,
): IterationChange[] {
  const workItemId = extractWorkItemId(draggedNode.id);
  if (workItemId === undefined) {
    return [];
  }

  const draggedWorkItem = wiMap.get(workItemId);
  const toIterationPath =
    state === null
      ? undefined
      : findIterationPath(draggedNode.position.x, state.sprintRanges ?? []);

  if (!draggedWorkItem || toIterationPath === undefined) {
    return [];
  }

  const iterationChanges: IterationChange[] = [];
  const pendingWorkItemIds = [draggedWorkItem.id];
  const visitedWorkItemIds = new Set<number>();

  while (pendingWorkItemIds.length > 0) {
    const currentWorkItemId = pendingWorkItemIds.shift();
    if (currentWorkItemId === undefined || visitedWorkItemIds.has(currentWorkItemId)) {
      continue;
    }
    visitedWorkItemIds.add(currentWorkItemId);

    const currentWorkItem = wiMap.get(currentWorkItemId);
    if (!currentWorkItem) {
      continue;
    }

    if (currentWorkItem.iteration_path !== toIterationPath) {
      iterationChanges.push({
        workItemId: currentWorkItem.id,
        fromIterationPath: currentWorkItem.iteration_path,
        toIterationPath,
      });
    }

    pendingWorkItemIds.push(...currentWorkItem.children);
  }

  return iterationChanges;
}

function buildDragUndoOperation(
  before: ReturnType<typeof capturePositions>,
  after: ReturnType<typeof capturePositions>,
  iterationChanges: IterationChange[],
): ReversibleOperation {
  if (iterationChanges.length > 0) {
    return {
      type: "moveWorkItem",
      before,
      after,
      iterationChanges,
    };
  }

  return { type: "moveNodes", before, after };
}

type SetNodes = (updater: (prev: Node[]) => Node[]) => void;

interface FinishDragOptions {
  draggedNode: Node;
  state: DragState | null;
  beforePositions: ReturnType<typeof capturePositions>;
  setNodes: SetNodes;
  wiMap: Map<number, WorkItem>;
  onDragSettled?: (finalNodes: Node[]) => void;
  onUndoPush?: (op: ReversibleOperation) => void;
  onSprintChange?: (iterationChanges: IterationChange[]) => void;
}

function finishDrag({
  draggedNode,
  state,
  beforePositions,
  setNodes,
  wiMap,
  onDragSettled,
  onUndoPush,
  onSprintChange,
}: FinishDragOptions): void {
  setNodes((prev) => {
    const constrainedPosition = state
      ? constrainDragPosition(state, draggedNode.position)
      : draggedNode.position;
    const constrainedNode = { ...draggedNode, position: constrainedPosition };
    const finalNodes = buildDragStopNodes(prev, state, constrainedNode);
    onDragSettled?.(finalNodes);

    const iterationChanges = getIterationChanges(constrainedNode, state, wiMap);
    if (iterationChanges.length > 0) {
      onSprintChange?.(iterationChanges);
    }

    if (onUndoPush) {
      const afterPositions = capturePositions(finalNodes);
      onUndoPush(buildDragUndoOperation(beforePositions, afterPositions, iterationChanges));
    }

    return finalNodes;
  });
}

// --- Hook ---

export function useDragReorder(
  setNodes: SetNodes,
  wiMap: Map<number, WorkItem>,
  onDragSettled?: (finalNodes: Node[]) => void,
  onUndoPush?: (op: ReversibleOperation) => void,
  onSprintChange?: (iterationChanges: IterationChange[]) => void,
) {
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef(0);
  const wiMapRef = useRef(wiMap);
  const preDragPositionsRef = useRef<ReturnType<typeof capturePositions>>(new Map());

  useEffect(() => {
    wiMapRef.current = wiMap;
  }, [wiMap]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      setNodes((prev) => {
        preDragPositionsRef.current = capturePositions(prev);
        const state = buildDragStartState(prev, draggedNode, wiMapRef.current);
        dragRef.current = state;
        return buildDragStartNodes(prev, state, draggedNode);
      });
    },
    [setNodes, wiMapRef],
  );

  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const state = dragRef.current;
        if (!state) {
          return;
        }
        const constrainedPosition = constrainDragPosition(state, draggedNode.position);
        const constrainedNode = {
          ...draggedNode,
          position: constrainedPosition,
        };
        const { slotPositions, ghostY, deltaX } = computeDragFrameState(state, constrainedNode);
        setNodes((prev) =>
          prev.map((node) => applyDragFrame(node, state, slotPositions, ghostY, deltaX)),
        );
      });
    },
    [setNodes],
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      cancelAnimationFrame(rafRef.current);
      const state = dragRef.current;
      const beforePositions = preDragPositionsRef.current;
      finishDrag({
        draggedNode,
        state,
        beforePositions,
        setNodes,
        wiMap: wiMapRef.current,
        onDragSettled,
        onUndoPush,
        onSprintChange,
      });
      dragRef.current = null;
    },
    [setNodes, onDragSettled, onUndoPush, onSprintChange, wiMapRef],
  );

  return { handleNodeDragStart, handleNodeDrag, handleNodeDragStop };
}
