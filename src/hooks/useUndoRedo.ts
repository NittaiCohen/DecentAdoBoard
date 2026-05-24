import type React from "react";
import { useCallback, useRef } from "react";
import type { ReversibleOperation, OperationContext } from "../utils/reversibleOperations";
import { applyOperation, reverseOperation } from "../utils/reversibleOperations";

const MAX_STACK_SIZE = 50;

export interface UndoRedoControls {
  push: (op: ReversibleOperation) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export function useUndoRedo(
  contextRef: React.RefObject<OperationContext | null>,
): UndoRedoControls {
  const undoStackRef = useRef<ReversibleOperation[]>([]);
  const redoStackRef = useRef<ReversibleOperation[]>([]);

  const push = useCallback((op: ReversibleOperation) => {
    undoStackRef.current.push(op);
    if (undoStackRef.current.length > MAX_STACK_SIZE) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }, []);

  const undo = useCallback(() => {
    const op = undoStackRef.current.pop();
    if (!op || !contextRef.current) {
      return;
    }
    applyOperation(reverseOperation(op), contextRef.current);
    redoStackRef.current.push(op);
  }, [contextRef]);

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop();
    if (!op || !contextRef.current) {
      return;
    }
    applyOperation(op, contextRef.current);
    undoStackRef.current.push(op);
  }, [contextRef]);

  const canUndo = useCallback(() => undoStackRef.current.length > 0, []);
  const canRedo = useCallback(() => redoStackRef.current.length > 0, []);

  return { push, undo, redo, canUndo, canRedo };
}
