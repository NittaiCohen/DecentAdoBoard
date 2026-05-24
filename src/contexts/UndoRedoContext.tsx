import type React from "react";
import { createContext, use } from "react";
import type { ReversibleOperation, OperationContext } from "../utils/reversibleOperations";

interface UndoRedoContextValue {
  push: (op: ReversibleOperation) => void;
  operationContextRef: React.RefObject<OperationContext | null>;
}

const UndoRedoContext = createContext<UndoRedoContextValue | null>(null);

export const UndoRedoProvider = UndoRedoContext.Provider;

function useUndoRedoContext(): UndoRedoContextValue {
  const value = use(UndoRedoContext);
  if (!value) {
    throw new Error("useUndoRedoPush must be used within an UndoRedoProvider");
  }
  return value;
}

export function useUndoRedoPush(): (op: ReversibleOperation) => void {
  return useUndoRedoContext().push;
}

export function useOperationContext(): React.RefObject<OperationContext | null> {
  return useUndoRedoContext().operationContextRef;
}
