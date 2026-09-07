import { useCallback, useEffect, useState } from "react";
import { useWorkItemTypeStates } from "../hooks/useWorkItemTypeStates";
import { useUndoRedoPush } from "../contexts/UndoRedoContext";
import { useOperationContext } from "../contexts/UndoRedoContext";
import type { ReversibleOperation } from "../utils/reversibleOperations";
import { applyOperation } from "../utils/reversibleOperations";
import StateSelector from "./StateSelector";

interface StateDropdownProps {
  workItemId: number;
  workItemType: string;
  currentState: string;
}

export default function StateDropdown({
  workItemId,
  workItemType,
  currentState,
}: StateDropdownProps) {
  const [displayState, setDisplayState] = useState(currentState);
  const pushUndo = useUndoRedoPush();
  const operationContextRef = useOperationContext();
  const [isOpen, setIsOpen] = useState(false);

  // Stay in sync when boardData refetches with authoritative data
  useEffect(() => {
    setDisplayState(currentState);
  }, [currentState]);

  const { data: states = [] } = useWorkItemTypeStates(workItemType, isOpen);

  const changeState = useCallback(
    (newState: string) => {
      const ctx = operationContextRef.current;
      if (!ctx) {
        return;
      }
      const op: ReversibleOperation = {
        type: "changeWorkItemState",
        workItemId,
        fromState: displayState,
        toState: newState,
      };
      applyOperation(op, ctx);
      pushUndo(op);
      setIsOpen(false);
    },
    [workItemId, displayState, pushUndo, operationContextRef],
  );

  return (
    <StateSelector
      value={displayState}
      options={states}
      onChange={changeState}
      onOpenChange={setIsOpen}
      portal
    />
  );
}
