import type { BoardData, Iteration, WorkItem } from "../types";
import { buildGraphLayout } from "./graphLayout";

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

describe("buildGraphLayout smoke", () => {
  it("returns no nodes or edges for an empty board", () => {
    expect(buildGraphLayout({ work_items: [], iterations: [] }, new Set())).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("renders a single item in a single sprint", () => {
    const result = buildGraphLayout(board([wi({ id: 1 })]), new Set());

    expect(result.nodes.filter((node) => node.type === "workItem")).toHaveLength(1);
    expect(result.nodes.filter((node) => node.type === "sprintDivider")).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it("renders a dependency edge for two items in the same sprint", () => {
    const items = [wi({ id: 1, successors: [2] }), wi({ id: 2, predecessors: [1] })];

    const result = buildGraphLayout(board(items), new Set());

    expect(result.nodes.filter((node) => node.type === "workItem")).toHaveLength(2);
    expect(result.nodes.filter((node) => node.type === "sprintDivider")).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: "wi-1", target: "wi-2" });
  });

  it("renders sprint dividers for multiple sprints", () => {
    const items = [
      wi({ id: 1, iteration_path: sprint1.path }),
      wi({ id: 2, iteration_path: sprint2.path }),
    ];

    const result = buildGraphLayout(board(items, [sprint1, sprint2]), new Set());

    expect(result.nodes.filter((node) => node.type === "sprintDivider")).toHaveLength(2);
  });

  it("renders an expanded multi-sprint parent as a group with visible children nested under it", () => {
    const items = [
      wi({ id: 1, title: "Parent", type: "Feature", children: [2, 3] }),
      wi({ id: 2, parent_id: 1, iteration_path: sprint1.path }),
      wi({ id: 3, parent_id: 1, iteration_path: sprint2.path }),
    ];

    const result = buildGraphLayout(board(items, [sprint1, sprint2]), new Set([1]));

    const group = result.nodes.find((node) => node.id === "group-1" && node.type === "parentGroup");
    expect(group).toBeTruthy();

    const child2 = result.nodes.find((node) => node.id === "wi-2");
    const child3 = result.nodes.find((node) => node.id === "wi-3");
    expect(child2).toBeTruthy();
    expect(child3).toBeTruthy();

    // Children must be nested under the parent group, not free-floating
    if (!child2 || !child3) {
      throw new Error("Expected child nodes to exist");
    }
    expect(child2.parentId).toBe("group-1");
    expect(child3.parentId).toBe("group-1");
  });

  it("renders a collapsed multi-sprint parent without visible child nodes", () => {
    const items = [
      wi({ id: 1, title: "Parent", type: "Feature", children: [2, 3] }),
      wi({ id: 2, parent_id: 1, iteration_path: sprint1.path }),
      wi({ id: 3, parent_id: 1, iteration_path: sprint2.path }),
    ];

    const result = buildGraphLayout(board(items, [sprint1, sprint2]), new Set());

    expect(
      result.nodes.find((node) => node.id === "group-1" && node.type === "parentGroup"),
    ).toBeTruthy();
    expect(result.nodes.find((node) => node.id === "wi-2")).toBeFalsy();
    expect(result.nodes.find((node) => node.id === "wi-3")).toBeFalsy();
  });

  it("is deterministic for identical input and produces expected structure", () => {
    const items = [
      wi({ id: 1, type: "Feature", children: [2, 3] }),
      wi({ id: 2, parent_id: 1, iteration_path: sprint1.path, successors: [3] }),
      wi({ id: 3, parent_id: 1, iteration_path: sprint2.path, predecessors: [2] }),
    ];
    const data = board(items, [sprint1, sprint2]);

    const first = buildGraphLayout(data, new Set([1]));
    const second = buildGraphLayout(data, new Set([1]));

    // Deterministic
    expect(first).toEqual(second);

    // Concrete structure checks: group node exists, children visible, edge present
    expect(first.nodes.find((n) => n.id === "group-1" && n.type === "parentGroup")).toBeTruthy();
    expect(first.nodes.find((n) => n.id === "wi-2")).toBeTruthy();
    expect(first.nodes.find((n) => n.id === "wi-3")).toBeTruthy();
    expect(first.edges.find((e) => e.source === "wi-2" && e.target === "wi-3")).toBeTruthy();

    // Sprint dividers present
    expect(first.nodes.filter((n) => n.type === "sprintDivider")).toHaveLength(2);
  });
});
