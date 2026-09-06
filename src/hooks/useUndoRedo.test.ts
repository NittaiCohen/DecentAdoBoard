import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useUndoRedo } from "./useUndoRedo";
import type { OperationContext, ReversibleOperation } from "../utils/reversibleOperations";
import { updateWorkItemIteration } from "../api/tauri";

vi.mock("../api/tauri", () => ({
  addDependency: vi.fn().mockResolvedValue(undefined),
  removeDependency: vi.fn().mockResolvedValue(undefined),
  updateWorkItemIteration: vi.fn().mockResolvedValue(undefined),
  updateWorkItemState: vi.fn().mockResolvedValue(undefined),
}));

function makeContextRef(): React.RefObject<OperationContext> {
  const mockQueryClient = {
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  };
  return {
    current: {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test mock
      queryClient: mockQueryClient as unknown as OperationContext["queryClient"],
      setNodes: vi.fn(),
    },
  };
}

function makeAddOp(sourceId: number, targetId: number): ReversibleOperation {
  return { type: "addDependencyRelation", sourceId, targetId };
}

function makeRemoveOp(sourceId: number, targetId: number): ReversibleOperation {
  return { type: "removeDependencyRelation", sourceId, targetId };
}

describe("useUndoRedo", () => {
  it("starts with empty stacks", () => {
    const { result } = renderHook(() => useUndoRedo(makeContextRef()));
    expect(result.current.canUndo()).toBe(false);
    expect(result.current.canRedo()).toBe(false);
  });

  it("can undo a pushed operation", () => {
    const contextRef = makeContextRef();
    const { result } = renderHook(() => useUndoRedo(contextRef));

    act(() => result.current.push(makeAddOp(1, 2)));
    expect(result.current.canUndo()).toBe(true);

    act(() => result.current.undo());
    // Undo of addDependencyRelation → removeDependencyRelation applied
    expect(result.current.canUndo()).toBe(false);
    expect(result.current.canRedo()).toBe(true);
  });

  it("can redo after undo", () => {
    const contextRef = makeContextRef();
    const { result } = renderHook(() => useUndoRedo(contextRef));

    act(() => result.current.push(makeAddOp(1, 2)));
    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(result.current.canUndo()).toBe(true);
    expect(result.current.canRedo()).toBe(false);
  });

  it("undoes a work item move and its iteration change together", () => {
    const contextRef = makeContextRef();
    const { result } = renderHook(() => useUndoRedo(contextRef));
    const operation: ReversibleOperation = {
      type: "moveWorkItem",
      before: new Map([["wi-42", { x: 100, y: 100 }]]),
      after: new Map([["wi-42", { x: 900, y: 300 }]]),
      iterationChanges: [
        {
          workItemId: 42,
          fromIterationPath: "Project\\Sprint 1",
          toIterationPath: "Project\\Sprint 2",
        },
        {
          workItemId: 43,
          fromIterationPath: "Project\\Sprint 1",
          toIterationPath: "Project\\Sprint 2",
        },
      ],
    };

    vi.mocked(updateWorkItemIteration).mockClear();
    act(() => result.current.push(operation));
    act(() => result.current.undo());

    expect(updateWorkItemIteration).toHaveBeenCalledWith(42, "Project\\Sprint 1");
    expect(updateWorkItemIteration).toHaveBeenCalledWith(43, "Project\\Sprint 1");
    expect(contextRef.current?.setNodes).toHaveBeenCalledTimes(1);
  });

  it("clears redo stack on new push", () => {
    const contextRef = makeContextRef();
    const { result } = renderHook(() => useUndoRedo(contextRef));

    act(() => result.current.push(makeAddOp(1, 2)));
    act(() => result.current.undo());
    expect(result.current.canRedo()).toBe(true);

    act(() => result.current.push(makeRemoveOp(3, 4)));
    expect(result.current.canRedo()).toBe(false);
  });

  it("handles multiple undo/redo in order", () => {
    const contextRef = makeContextRef();
    const { result } = renderHook(() => useUndoRedo(contextRef));

    act(() => result.current.push(makeAddOp(1, 2)));
    act(() => result.current.push(makeRemoveOp(3, 4)));

    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.canUndo()).toBe(false);

    act(() => result.current.redo());
    act(() => result.current.redo());
    expect(result.current.canRedo()).toBe(false);
    expect(result.current.canUndo()).toBe(true);
  });

  it("does nothing when undo is called on empty stack", () => {
    const { result } = renderHook(() => useUndoRedo(makeContextRef()));
    act(() => result.current.undo());
    expect(result.current.canUndo()).toBe(false);
  });

  it("does nothing when redo is called on empty stack", () => {
    const { result } = renderHook(() => useUndoRedo(makeContextRef()));
    act(() => result.current.redo());
    expect(result.current.canRedo()).toBe(false);
  });

  it("caps undo stack at 50 entries", () => {
    const contextRef = makeContextRef();
    const { result } = renderHook(() => useUndoRedo(contextRef));

    for (let i = 0; i < 60; i++) {
      act(() => result.current.push(makeAddOp(i, i + 100)));
    }

    let undoCount = 0;
    while (result.current.canUndo()) {
      act(() => result.current.undo());
      undoCount++;
    }
    expect(undoCount).toBe(50);
  });
});
