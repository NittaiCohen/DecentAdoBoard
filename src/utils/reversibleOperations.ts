import type { Node } from "@xyflow/react";
import type { QueryClient } from "@tanstack/react-query";
import type { BoardData, Point } from "../types";
import {
  addDependency,
  removeDependency,
  updateWorkItemIteration,
  updateWorkItemState,
} from "../api/tauri";

export type NodePositionSnapshot = Map<string, Point>;

export interface IterationChange {
  workItemId: number;
  fromIterationPath: string;
  toIterationPath: string;
}

export function capturePositions(nodes: Node[]): NodePositionSnapshot {
  const snapshot = new Map<string, Point>();
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
  | ({ type: "changeWorkItemIteration" } & IterationChange)
  | {
      type: "moveWorkItem";
      before: NodePositionSnapshot;
      after: NodePositionSnapshot;
      iterationChanges: IterationChange[];
    }
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
    case "changeWorkItemIteration":
      return {
        type: "changeWorkItemIteration",
        workItemId: op.workItemId,
        fromIterationPath: op.toIterationPath,
        toIterationPath: op.fromIterationPath,
      };
    case "moveWorkItem":
      return {
        type: "moveWorkItem",
        before: op.after,
        after: op.before,
        iterationChanges: op.iterationChanges.map((iterationChange) => ({
          workItemId: iterationChange.workItemId,
          fromIterationPath: iterationChange.toIterationPath,
          toIterationPath: iterationChange.fromIterationPath,
        })),
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

function applyChangeWorkItemIteration(
  workItemId: number,
  toIterationPath: string,
  queryClient: QueryClient,
): void {
  void updateWorkItemIteration(workItemId, toIterationPath);
  queryClient.setQueryData<BoardData>(["boardData"], (old) => {
    if (!old) {
      return old;
    }
    return {
      ...old,
      work_items: old.work_items.map((workItem) =>
        workItem.id === workItemId ? { ...workItem, iteration_path: toIterationPath } : workItem,
      ),
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
    case "changeWorkItemIteration": {
      applyChangeWorkItemIteration(op.workItemId, op.toIterationPath, context.queryClient);
      break;
    }
    case "moveWorkItem": {
      op.iterationChanges.forEach((iterationChange) => {
        applyChangeWorkItemIteration(
          iterationChange.workItemId,
          iterationChange.toIterationPath,
          context.queryClient,
        );
      });
      context.setNodes((current) => {
        const restored = applyPositionSnapshot(current, op.after);
        context.onDragSettled?.(restored);
        return restored;
      });
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
