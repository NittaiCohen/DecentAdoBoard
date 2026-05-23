import { describe, it, expect } from "vitest";
import { wouldCreateCycle } from "./dependencies";
import type { WorkItem } from "../types";

function makeItem(id: number, successors: number[] = []): WorkItem {
  return {
    id,
    title: `Item ${id}`,
    state: "Active",
    type: "Task",
    assigned_to: null,
    iteration_path: "Project\\Sprint 1",
    area_path: "Project",
    predecessors: [],
    successors,
    parent_id: null,
    children: [],
  };
}

function buildMap(items: WorkItem[]): Map<number, WorkItem> {
  return new Map(items.map((item) => [item.id, item]));
}

describe("wouldCreateCycle", () => {
  it("returns false for a simple chain with no cycle", () => {
    // 1 → 2 → 3, adding 3 → 4 should be fine
    const map = buildMap([makeItem(1, [2]), makeItem(2, [3]), makeItem(3), makeItem(4)]);
    expect(wouldCreateCycle(3, 4, map)).toBe(false);
  });

  it("detects a direct cycle", () => {
    // 1 → 2, adding 2 → 1 would create 1 → 2 → 1
    const map = buildMap([makeItem(1, [2]), makeItem(2)]);
    expect(wouldCreateCycle(2, 1, map)).toBe(true);
  });

  it("detects a transitive cycle", () => {
    // 1 → 2 → 3, adding 3 → 1 would create 1 → 2 → 3 → 1
    const map = buildMap([makeItem(1, [2]), makeItem(2, [3]), makeItem(3)]);
    expect(wouldCreateCycle(3, 1, map)).toBe(true);
  });

  it("detects a self-loop", () => {
    const map = buildMap([makeItem(1)]);
    expect(wouldCreateCycle(1, 1, map)).toBe(true);
  });

  it("returns false when items are unrelated", () => {
    const map = buildMap([makeItem(1), makeItem(2)]);
    expect(wouldCreateCycle(1, 2, map)).toBe(false);
  });

  it("returns false for a diamond that is not circular", () => {
    // 1 → 2, 1 → 3, 2 → 4, 3 → 4, adding 4 → 5 is fine
    const map = buildMap([
      makeItem(1, [2, 3]),
      makeItem(2, [4]),
      makeItem(3, [4]),
      makeItem(4),
      makeItem(5),
    ]);
    expect(wouldCreateCycle(4, 5, map)).toBe(false);
  });

  it("detects cycle through a diamond", () => {
    // 1 → 2, 1 → 3, 2 → 4, 3 → 4, adding 4 → 1 would create a cycle
    const map = buildMap([makeItem(1, [2, 3]), makeItem(2, [4]), makeItem(3, [4]), makeItem(4)]);
    expect(wouldCreateCycle(4, 1, map)).toBe(true);
  });
});
