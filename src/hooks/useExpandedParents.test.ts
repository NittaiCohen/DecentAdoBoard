import { act, renderHook } from "@testing-library/react";
import type { BoardData } from "../types";
import { useExpandedParents } from "./useExpandedParents";
import { generateWorkItem } from "../utils/test-helpers";

const generateBoardData = (parentIds: Array<number | null>): BoardData => ({
  work_items: parentIds.map((parentId, index) =>
    generateWorkItem({ id: index + 1, parent_id: parentId }),
  ),
  iterations: [],
});

describe("useExpandedParents", () => {
  it("starts with an empty set when no board data is provided", () => {
    const { result } = renderHook(() => useExpandedParents(undefined));

    expect(result.current[0]).toEqual(new Set());
  });

  it("initializes expansion from parent ids in board data", () => {
    const boardData = generateBoardData([100, 200, 100, null]);
    const { result } = renderHook(() => useExpandedParents(boardData));

    expect(result.current[0]).toEqual(new Set([100, 200]));
  });

  it("removes an expanded parent when toggled", () => {
    const boardData = generateBoardData([100]);
    const { result } = renderHook(() => useExpandedParents(boardData));

    act(() => {
      result.current[1](100);
    });

    expect(result.current[0]).toEqual(new Set());
  });

  it("adds a parent when toggled on", () => {
    const boardData = generateBoardData([null]);
    const { result } = renderHook(() => useExpandedParents(boardData));

    act(() => {
      result.current[1](100);
    });

    expect(result.current[0]).toEqual(new Set([100]));
  });

  it("adds newly discovered parent ids when board data changes", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: BoardData | undefined }) => useExpandedParents(data),
      {
        initialProps: { data: generateBoardData([100]) },
      },
    );

    rerender({ data: generateBoardData([100, 200]) });

    expect(result.current[0]).toEqual(new Set([100, 200]));
  });

  it("removes parent from expanded set when toggled off", () => {
    const { result } = renderHook(
      ({ data }: { data: BoardData | undefined }) => useExpandedParents(data),
      {
        initialProps: { data: generateBoardData([100]) },
      },
    );

    act(() => {
      result.current[1](100);
    });

    expect(result.current[0]).toEqual(new Set());
  });

  it("re-adds toggled-off parent when board data changes", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: BoardData | undefined }) => useExpandedParents(data),
      {
        initialProps: { data: generateBoardData([100]) },
      },
    );

    act(() => {
      result.current[1](100);
    });

    rerender({ data: generateBoardData([100, 200]) });

    expect(result.current[0]).toEqual(new Set([100, 200]));
  });
});
