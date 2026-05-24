import type { Node } from "@xyflow/react";
import type { QueryClient } from "@tanstack/react-query";
import type { BoardData } from "../types";
import { addDependency, removeDependency, updateWorkItemState } from "../api/tauri";

export type NodePositionSnapshot = Map<string, { x: number; y: number }>;

export function capturePositions(nodes: Node[]): NodePositionSnapshot {
  const snapshot = new Map<string, { x: number; y: number }>();
  nodes.forEach((n) => {
    snapshot.set(n.id, { x: n.position.x, y: n.position.y });
  });
  return snapshot;
}

export function applyPositionSnapshot(nodes: Node[], snapshot: NodePositionSnapshot): Node[] {
  return nodes.map((node) => {
    const pos = snapshot.get(node.id);
    if (pos) {
      return { ...node, position: { ...pos } };
    }
    return node;
  });
}

export type ReversibleOperation =
  | { type: "addDependencyRelation"; sourceId: number; targetId: number }
  | { type: "removeDependencyRelation"; sourceId: number; targetId: number }
  | { type: "changeWorkItemState"; workItemId: number; fromState: string; toState: string }
  | { type: "moveNodes"; before: NodePositionSnapshot; after: NodePositionSnapshot };

export function reverseOperation(op: ReversibleOperation): ReversibleOperation {
  switch (op.type) {
    case "addDependencyRelation":
      return { type: "removeDependencyRelation", sourceId: op.sourceId, targetId: op.targetId };
    case "removeDependencyRelation":
      return { type: "addDependencyRelation", sourceId: op.sourceId, targetId: op.targetId };
    case "changeWorkItemState":
      return {
        type: "changeWorkItemState",
        workItemId: op.workItemId,
        fromState: op.toState,
        toState: op.fromState,
      };
    case "moveNodes":
      return { type: "moveNodes", before: op.after, after: op.before };
  }
}

type SetNodes = (updater: (nodes: Node[]) => Node[]) => void;

export interface OperationContext {
  queryClient: QueryClient;
  setNodes: SetNodes;
  onDragSettled?: (finalNodes: Node[]) => void;
}

function applyAddDependencyRelation(
  sourceId: number,
  targetId: number,
  queryClient: QueryClient,
): void {
  void addDependency(sourceId, targetId);
  queryClient.setQueryData<BoardData>(["boardData"], (old) => {
    if (!old) {
      return old;
    }
    return {
      ...old,
      work_items: old.work_items.map((workItem) => {
        if (workItem.id === sourceId) {
          return { ...workItem, successors: [...workItem.successors, targetId] };
        }
        if (workItem.id === targetId) {
          return { ...workItem, predecessors: [...workItem.predecessors, sourceId] };
        }
        return workItem;
      }),
    };
  });
}

function applyRemoveDependencyRelation(
  sourceId: number,
  targetId: number,
  queryClient: QueryClient,
): void {
  void removeDependency(sourceId, targetId);
  queryClient.setQueryData<BoardData>(["boardData"], (old) => {
    if (!old) {
      return old;
    }
    return {
      ...old,
      work_items: old.work_items.map((workItem) => {
        if (workItem.id === sourceId) {
          return {
            ...workItem,
            successors: workItem.successors.filter((id) => id !== targetId),
          };
        }
        if (workItem.id === targetId) {
          return {
            ...workItem,
            predecessors: workItem.predecessors.filter((id) => id !== sourceId),
          };
        }
        return workItem;
      }),
    };
  });
}

function applyChangeWorkItemState(
  workItemId: number,
  toState: string,
  queryClient: QueryClient,
): void {
  void updateWorkItemState(workItemId, toState);
  queryClient.setQueryData<BoardData>(["boardData"], (old) => {
    if (!old) {
      return old;
    }
    return {
      ...old,
      work_items: old.work_items.map((workItem) => {
        if (workItem.id === workItemId) {
          return { ...workItem, state: toState };
        }
        return workItem;
      }),
    };
  });
}

// --- Apply operation ---

export function applyOperation(op: ReversibleOperation, context: OperationContext): void {
  switch (op.type) {
    case "addDependencyRelation": {
      applyAddDependencyRelation(op.sourceId, op.targetId, context.queryClient);
      break;
    }
    case "removeDependencyRelation": {
      applyRemoveDependencyRelation(op.sourceId, op.targetId, context.queryClient);
      break;
    }
    case "changeWorkItemState": {
      applyChangeWorkItemState(op.workItemId, op.toState, context.queryClient);
      break;
    }
    case "moveNodes": {
      context.setNodes((current) => {
        const restored = applyPositionSnapshot(current, op.after);
        context.onDragSettled?.(restored);
        return restored;
      });
      break;
    }
  }
}
