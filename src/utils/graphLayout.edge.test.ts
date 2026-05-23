import type { BoardData, Iteration, WorkItem } from "../types";
import { buildGraphLayout, NODE_GAP_Y, NODE_HEIGHT } from "./graphLayout";

const sprint1: Iteration = {
  id: "Project\\Sprint1",
  name: "Sprint 1",
  path: "Project\\Sprint1",
  start_date: "2025-01-06T00:00:00Z",
  finish_date: "2025-01-17T00:00:00Z",
};

const sprint2: Iteration = {
  id: "Project\\Sprint2",
  name: "Sprint 2",
  path: "Project\\Sprint2",
  start_date: "2025-01-20T00:00:00Z",
  finish_date: "2025-01-31T00:00:00Z",
};

function wi(overrides: Partial<WorkItem> & { id: number }): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    state: "New",
    type: "Task",
    assigned_to: null,
    iteration_path: sprint1.path,
    area_path: "Area",
    predecessors: [],
    successors: [],
    parent_id: null,
    children: [],
    ...overrides,
  };
}

function board(work_items: WorkItem[], iterations: Iteration[] = [sprint1]): BoardData {
  return { work_items, iterations };
}

function workItemNodes(result: ReturnType<typeof buildGraphLayout>) {
  return result.nodes.filter((node) => node.id.startsWith("wi-") && node.type === "workItem");
}

describe("buildGraphLayout edge cases", () => {
  it("returns only divider nodes for an empty board when iterations exist", () => {
    const result = buildGraphLayout({ work_items: [], iterations: [sprint1, sprint2] }, new Set());

    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every((node) => node.type === "sprintDivider")).toBe(true);
  });

  it("positions a single item at reasonable coordinates", () => {
    const result = buildGraphLayout(board([wi({ id: 1 })]), new Set());
    const node = result.nodes.find((entry) => entry.id === "wi-1");

    expect(node).toBeTruthy();
    expect(node?.position.x).toBeGreaterThanOrEqual(0);
    expect(node?.position.y).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic across repeated runs", () => {
    const data = board([
      wi({ id: 1, successors: [2] }),
      wi({ id: 2, predecessors: [1], successors: [3] }),
      wi({ id: 3, predecessors: [2] }),
    ]);

    const first = buildGraphLayout(data, new Set());
    const second = buildGraphLayout(data, new Set());
    const third = buildGraphLayout(data, new Set());

    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it("does not overlap visible work item nodes in a crowded sprint", () => {
    const items = Array.from({ length: 25 }, (_, index) => wi({ id: index + 1 }));
    const nodes = workItemNodes(buildGraphLayout(board(items), new Set())).sort(
      (a, b) => a.position.y - b.position.y,
    );

    expect(nodes).toHaveLength(25);
    for (let index = 1; index < nodes.length; index++) {
      expect(nodes[index].position.y - nodes[index - 1].position.y).toBeGreaterThanOrEqual(
        NODE_HEIGHT + NODE_GAP_Y,
      );
    }
  });

  it("handles circular dependencies without crashing and renders all items", () => {
    const items = [
      wi({ id: 1, predecessors: [3], successors: [2] }),
      wi({ id: 2, predecessors: [1], successors: [3] }),
      wi({ id: 3, predecessors: [2], successors: [1] }),
    ];

    const result = buildGraphLayout(board(items), new Set());

    expect(workItemNodes(result)).toHaveLength(3);
  });

  it("lays out a long dependency chain from left to right", () => {
    const items = Array.from({ length: 20 }, (_, index) => {
      const id = index + 1;
      return wi({
        id,
        predecessors: id === 1 ? [] : [id - 1],
        successors: id === 20 ? [] : [id + 1],
      });
    });
    const nodesById = new Map(
      workItemNodes(buildGraphLayout(board(items), new Set())).map((node) => [node.id, node]),
    );

    expect(nodesById.size).toBe(20);
    for (let id = 1; id < 20; id++) {
      const current = nodesById.get(`wi-${id}`);
      const next = nodesById.get(`wi-${id + 1}`);
      expect(current).toBeTruthy();
      expect(next).toBeTruthy();
      if (!current || !next) {
        throw new Error("Expected chain nodes to be present");
      }
      expect(next.position.x).toBeGreaterThan(current.position.x);
    }
  });

  it("does not crash when an item iteration is missing from the iteration list", () => {
    const result = buildGraphLayout(
      board([wi({ id: 1, iteration_path: "Project\\Unplanned" })], [sprint1]),
      new Set(),
    );

    expect(result.nodes.find((node) => node.id === "wi-1")).toBeTruthy();
  });

  it("renders a parent even when its children are outside listed iterations", () => {
    const result = buildGraphLayout(
      board(
        [
          wi({ id: 1, iteration_path: sprint1.path, children: [2, 3] }),
          wi({ id: 2, parent_id: 1, iteration_path: sprint2.path }),
          wi({ id: 3, parent_id: 1, iteration_path: sprint2.path }),
        ],
        [sprint1],
      ),
      new Set(),
    );

    expect(result.nodes.find((node) => node.id === "wi-1")).toBeTruthy();
  });
});
