import type { BoardData, Iteration, WorkItem } from "../types";
import {
  buildGraphLayout,
  computeDependencyDepths,
  enforceSuccessorOrdering,
  NODE_GAP_Y,
  NODE_HEIGHT,
} from "./graphLayout";
import { generateWorkItem as generateWorkItemBase } from "./test-helpers";

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

function generateWorkItem(overrides: Partial<WorkItem> & { id: number }): WorkItem {
  return generateWorkItemBase({ iteration_path: sprint1.path, ...overrides });
}

function generateMap(items: WorkItem[]): Map<number, WorkItem> {
  return new Map(items.map((item) => [item.id, item]));
}

function board(work_items: WorkItem[], iterations: Iteration[] = [sprint1]): BoardData {
  return { work_items, iterations };
}

function workItemNodes(result: ReturnType<typeof buildGraphLayout>) {
  return result.nodes.filter((node) => node.id.startsWith("wi-") && node.type === "workItem");
}

describe("computeDependencyDepths", () => {
  it("computes depths for a linear chain", () => {
    /*
     *  [1] ──→ [2] ──→ [3]
     *  Depths: 1→0, 2→1, 3→2
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1], successors: [3] }),
      generateWorkItem({ id: 3, predecessors: [2] }),
    ];

    const result = computeDependencyDepths(items, generateMap(items));

    expect(result.depths).toEqual(
      new Map([
        [1, 0],
        [2, 1],
        [3, 2],
      ]),
    );
    expect(result.maxDepth).toBe(2);
  });

  it("computes depths for a diamond graph", () => {
    /*
     *       ┌──→ [2] ──┐
     *  [1] ─┤           ├──→ [4]
     *       └──→ [3] ──┘
     *  Depths: 1→0, 2→1, 3→1, 4→2
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2, 3] }),
      generateWorkItem({ id: 2, predecessors: [1], successors: [4] }),
      generateWorkItem({ id: 3, predecessors: [1], successors: [4] }),
      generateWorkItem({ id: 4, predecessors: [2, 3] }),
    ];

    const result = computeDependencyDepths(items, generateMap(items));

    expect(result.depths).toEqual(
      new Map([
        [1, 0],
        [2, 1],
        [3, 1],
        [4, 2],
      ]),
    );
    expect(result.maxDepth).toBe(2);
  });

  it("handles disconnected graphs", () => {
    /*
     *  [1] ──→ [2]     [3]
     *  Depths: 1→0, 2→1, 3→0
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1] }),
      generateWorkItem({ id: 3 }),
    ];

    const result = computeDependencyDepths(items, generateMap(items));

    expect(result.depths).toEqual(
      new Map([
        [1, 0],
        [2, 1],
        [3, 0],
      ]),
    );
    expect(result.maxDepth).toBe(1);
  });

  it("assigns depth zero to unvisited cycle nodes", () => {
    /*
     *  [1] ←──→ [2]
     *  Cycle → both get depth 0
     */
    const items = [
      generateWorkItem({ id: 1, predecessors: [2], successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1], successors: [1] }),
    ];

    const result = computeDependencyDepths(items, generateMap(items));

    expect(result.depths).toEqual(
      new Map([
        [1, 0],
        [2, 0],
      ]),
    );
    expect(result.maxDepth).toBe(0);
  });
});

describe("enforceSuccessorOrdering", () => {
  it("shifts a successor to the right when needed", () => {
    /*
     *  [1] ──→ [2]
     *  Both start at col 0 → 2 shifted to col 1
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1] }),
    ];
    const itemEffCol = new Map([
      [1, 0],
      [2, 0],
    ]);

    enforceSuccessorOrdering(itemEffCol, generateMap(items));

    expect(itemEffCol).toEqual(
      new Map([
        [1, 0],
        [2, 1],
      ]),
    );
  });

  it("propagates shifts across a chain", () => {
    /*
     *  [1] ──→ [2] ──→ [3]
     *  All start at col 0 → cascading shift: 1→0, 2→1, 3→2
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1], successors: [3] }),
      generateWorkItem({ id: 3, predecessors: [2] }),
    ];
    const itemEffCol = new Map([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);

    enforceSuccessorOrdering(itemEffCol, generateMap(items));

    expect(itemEffCol).toEqual(
      new Map([
        [1, 0],
        [2, 1],
        [3, 2],
      ]),
    );
  });

  it("leaves already ordered items unchanged", () => {
    /*
     *  [1] ──→ [2]
     *  1 at col 0, 2 at col 2 → already ordered, no change
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1] }),
    ];
    const itemEffCol = new Map([
      [1, 0],
      [2, 2],
    ]);

    enforceSuccessorOrdering(itemEffCol, generateMap(items));

    expect(itemEffCol).toEqual(
      new Map([
        [1, 0],
        [2, 2],
      ]),
    );
  });

  it("ignores successors outside the tracked column set", () => {
    /*
     *  [1] ──→ [2]
     *  Only 1 is tracked → 2 is not in the map, ignored
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1] }),
    ];
    const itemEffCol = new Map([[1, 0]]);

    enforceSuccessorOrdering(itemEffCol, generateMap(items));

    expect(itemEffCol).toEqual(new Map([[1, 0]]));
  });
});

describe("buildGraphLayout smoke", () => {
  it("returns no nodes or edges for an empty board", () => {
    /*
     *  (no items, no iterations)
     *  Empty board → empty result
     */
    expect(buildGraphLayout({ work_items: [], iterations: [] }, new Set())).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("renders a single item in a single sprint", () => {
    /*
     *  Sprint 1: [1]
     *  1 work item node + 1 sprint divider, no edges
     */
    const result = buildGraphLayout(board([generateWorkItem({ id: 1 })]), new Set());

    expect(result.nodes.filter((node) => node.type === "workItem")).toHaveLength(1);
    expect(result.nodes.filter((node) => node.type === "sprintDivider")).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it("renders a dependency edge for two items in the same sprint", () => {
    /*
     *  Sprint 1: [1] ──→ [2]
     *  2 work item nodes + 1 sprint divider + 1 edge
     */
    const items = [
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1] }),
    ];

    const result = buildGraphLayout(board(items), new Set());

    expect(result.nodes.filter((node) => node.type === "workItem")).toHaveLength(2);
    expect(result.nodes.filter((node) => node.type === "sprintDivider")).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: "wi-1", target: "wi-2" });
  });

  it("renders sprint dividers for multiple sprints", () => {
    /*
     *  Sprint 1: [1]  |  Sprint 2: [2]
     *  2 sprint dividers
     */
    const items = [
      generateWorkItem({ id: 1, iteration_path: sprint1.path }),
      generateWorkItem({ id: 2, iteration_path: sprint2.path }),
    ];

    const result = buildGraphLayout(board(items, [sprint1, sprint2]), new Set());

    expect(result.nodes.filter((node) => node.type === "sprintDivider")).toHaveLength(2);
  });

  it("renders an expanded multi-sprint parent as a group with visible children nested under it", () => {
    /*
     *  ┌── [1 Feature] (expanded) ──────┐
     *  │ Sprint 1: [2]  |  Sprint 2: [3] │
     *  └──────────────────────────────────┘
     *  Children nested under parent group
     */
    const items = [
      generateWorkItem({ id: 1, title: "Parent", work_item_type: "Feature", children: [2, 3] }),
      generateWorkItem({ id: 2, parent_id: 1, iteration_path: sprint1.path }),
      generateWorkItem({ id: 3, parent_id: 1, iteration_path: sprint2.path }),
    ];

    const result = buildGraphLayout(board(items, [sprint1, sprint2]), new Set([1]));

    const group = result.nodes.find((node) => node.id === "group-1" && node.type === "parentGroup");
    expect(group).toBeTruthy();

    const child2 = result.nodes.find((node) => node.id === "wi-2");
    const child3 = result.nodes.find((node) => node.id === "wi-3");
    expect(child2).toBeTruthy();
    expect(child3).toBeTruthy();
    if (!child2 || !child3) {
      throw new Error("child nodes not found");
    }

    expect(child2.parentId).toBe("group-1");
    expect(child3.parentId).toBe("group-1");
  });

  it("renders a collapsed multi-sprint parent without visible child nodes", () => {
    /*
     *  [1 Feature] (collapsed)
     *  Children 2, 3 hidden
     */
    const items = [
      generateWorkItem({ id: 1, title: "Parent", work_item_type: "Feature", children: [2, 3] }),
      generateWorkItem({ id: 2, parent_id: 1, iteration_path: sprint1.path }),
      generateWorkItem({ id: 3, parent_id: 1, iteration_path: sprint2.path }),
    ];

    const result = buildGraphLayout(board(items, [sprint1, sprint2]), new Set());

    expect(
      result.nodes.find((node) => node.id === "group-1" && node.type === "parentGroup"),
    ).toBeTruthy();
    expect(result.nodes.find((node) => node.id === "wi-2")).toBeFalsy();
    expect(result.nodes.find((node) => node.id === "wi-3")).toBeFalsy();
  });

  it("is deterministic for identical input", () => {
    /*
     *  ┌── [1 Feature] (expanded) ────────────┐
     *  │ Sprint 1: [2] ──→ Sprint 2: [3]      │
     *  └──────────────────────────────────────┘
     *  Same input → same output on every call
     */
    const items = [
      generateWorkItem({ id: 1, work_item_type: "Feature", children: [2, 3] }),
      generateWorkItem({ id: 2, parent_id: 1, iteration_path: sprint1.path, successors: [3] }),
      generateWorkItem({ id: 3, parent_id: 1, iteration_path: sprint2.path, predecessors: [2] }),
    ];
    const data = board(items, [sprint1, sprint2]);

    const first = buildGraphLayout(data, new Set([1]));
    const second = buildGraphLayout(data, new Set([1]));

    expect(first).toEqual(second);
  });

  it("produces expected structure for expanded multi-sprint parent", () => {
    /*
     *  ┌── [1 Feature] (expanded) ────────────┐
     *  │ Sprint 1: [2] ──→ Sprint 2: [3]      │
     *  └──────────────────────────────────────┘
     *  Group node + child nodes + edge + 2 sprint dividers
     */
    const items = [
      generateWorkItem({ id: 1, work_item_type: "Feature", children: [2, 3] }),
      generateWorkItem({ id: 2, parent_id: 1, iteration_path: sprint1.path, successors: [3] }),
      generateWorkItem({ id: 3, parent_id: 1, iteration_path: sprint2.path, predecessors: [2] }),
    ];
    const data = board(items, [sprint1, sprint2]);

    const first = buildGraphLayout(data, new Set([1]));

    expect(first.nodes.find((n) => n.id === "group-1" && n.type === "parentGroup")).toBeTruthy();
    expect(first.nodes.find((n) => n.id === "wi-2")).toBeTruthy();
    expect(first.nodes.find((n) => n.id === "wi-3")).toBeTruthy();
    expect(first.edges.find((e) => e.source === "wi-2" && e.target === "wi-3")).toBeTruthy();

    expect(first.nodes.filter((n) => n.type === "sprintDivider")).toHaveLength(2);
  });
});

describe("buildGraphLayout edge cases", () => {
  it("returns only divider nodes for an empty board when iterations exist", () => {
    /*
     *  Sprint 1: (empty)  |  Sprint 2: (empty)
     *  No items → only 2 sprint divider nodes
     */
    const result = buildGraphLayout({ work_items: [], iterations: [sprint1, sprint2] }, new Set());

    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every((node) => node.type === "sprintDivider")).toBe(true);
  });

  it("positions a single item at reasonable coordinates", () => {
    /*
     *  Sprint 1: [1]
     *  Node should be at non-negative coordinates
     */
    const result = buildGraphLayout(board([generateWorkItem({ id: 1 })]), new Set());
    const node = result.nodes.find((entry) => entry.id === "wi-1");

    expect(node).toBeTruthy();
    expect(node?.position.x).toBeGreaterThanOrEqual(0);
    expect(node?.position.y).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic across repeated runs", () => {
    /*
     *  Sprint 1: [1] ──→ [2] ──→ [3]
     *  Three runs → identical output each time
     */
    const data = board([
      generateWorkItem({ id: 1, successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1], successors: [3] }),
      generateWorkItem({ id: 3, predecessors: [2] }),
    ]);

    const first = buildGraphLayout(data, new Set());
    const second = buildGraphLayout(data, new Set());
    const third = buildGraphLayout(data, new Set());

    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it("does not overlap visible work item nodes in a crowded sprint", () => {
    /*
     *  Sprint 1: [1], [2], ..., [25]
     *  25 independent items → each spaced by at least NODE_HEIGHT + NODE_GAP_Y
     */
    const items = Array.from({ length: 25 }, (_, index) => generateWorkItem({ id: index + 1 }));
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
    /*
     *  [1] ──→ [2] ──→ [3] ──→ [1]  (cycle)
     *  Should not crash, all 3 items rendered
     */
    const items = [
      generateWorkItem({ id: 1, predecessors: [3], successors: [2] }),
      generateWorkItem({ id: 2, predecessors: [1], successors: [3] }),
      generateWorkItem({ id: 3, predecessors: [2], successors: [1] }),
    ];

    const result = buildGraphLayout(board(items), new Set());

    expect(workItemNodes(result)).toHaveLength(3);
  });

  it("lays out a long dependency chain from left to right", () => {
    /*
     *  [1] ──→ [2] ──→ ... ──→ [20]
     *  Each successor positioned further right than its predecessor
     */
    const items = Array.from({ length: 20 }, (_, index) => {
      const id = index + 1;
      return generateWorkItem({
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
      board([generateWorkItem({ id: 1, iteration_path: "Project\\Unplanned" })], [sprint1]),
      new Set(),
    );

    expect(result.nodes.find((node) => node.id === "wi-1")).toBeTruthy();
  });

  it("renders a parent even when its children are outside listed iterations", () => {
    const result = buildGraphLayout(
      board(
        [
          generateWorkItem({ id: 1, iteration_path: sprint1.path, children: [2, 3] }),
          generateWorkItem({ id: 2, parent_id: 1, iteration_path: sprint2.path }),
          generateWorkItem({ id: 3, parent_id: 1, iteration_path: sprint2.path }),
        ],
        [sprint1],
      ),
      new Set(),
    );

    expect(result.nodes.find((node) => node.id === "wi-1")).toBeTruthy();
  });
});

describe("expanded parent multi-column layout", () => {
  it("lays out children with dependencies in separate columns", () => {
    /*
     *  ┌─── PBI 1 (expanded) ───┐
     *  │  [2] ──→ [3]           │
     *  └────────────────────────┘
     *  col 0      col 1
     */
    const parent = generateWorkItem({
      id: 1,
      children: [2, 3],
      work_item_type: "Product Backlog Item",
    });
    const child1 = generateWorkItem({ id: 2, parent_id: 1, successors: [3] });
    const child2 = generateWorkItem({ id: 3, parent_id: 1, predecessors: [2] });

    const result = buildGraphLayout(board([parent, child1, child2]), new Set([1]));

    const node2 = result.nodes.find((n) => n.id === "wi-2");
    const node3 = result.nodes.find((n) => n.id === "wi-3");
    expect(node2).toBeDefined();
    expect(node3).toBeDefined();
    if (!node2 || !node3) {
      throw new Error("child nodes not found");
    }

    expect(node3.position.x).toBeGreaterThan(node2.position.x);
  });

  it("keeps children without dependencies in a single column", () => {
    /*
     *  ┌─── PBI 1 (expanded) ───┐
     *  │  [2]                    │
     *  │  [3]                    │
     *  └────────────────────────┘
     *  col 0 (single column, stacked vertically)
     */
    const parent = generateWorkItem({
      id: 1,
      children: [2, 3],
      work_item_type: "Product Backlog Item",
    });
    const child1 = generateWorkItem({ id: 2, parent_id: 1 });
    const child2 = generateWorkItem({ id: 3, parent_id: 1 });

    const result = buildGraphLayout(board([parent, child1, child2]), new Set([1]));

    const node2 = result.nodes.find((n) => n.id === "wi-2");
    const node3 = result.nodes.find((n) => n.id === "wi-3");
    expect(node2).toBeDefined();
    expect(node3).toBeDefined();
    if (!node2 || !node3) {
      throw new Error("child nodes not found");
    }

    expect(node2.position.x).toBe(node3.position.x);
    expect(node3.position.y).toBeGreaterThan(node2.position.y);
  });

  it("aligns a successor Y with its predecessor Y", () => {
    /*
     *  ┌─── PBI 1 (expanded) ─────────┐
     *  │  [2]                          │
     *  │  [3] ──→ [4]   ← same Y row  │
     *  └──────────────────────────────┘
     *  col 0      col 1
     */
    const parent = generateWorkItem({
      id: 1,
      children: [2, 3, 4],
      work_item_type: "Product Backlog Item",
    });
    const child1 = generateWorkItem({ id: 2, parent_id: 1 });
    const child2 = generateWorkItem({ id: 3, parent_id: 1, successors: [4] });
    const child3 = generateWorkItem({ id: 4, parent_id: 1, predecessors: [3] });

    const result = buildGraphLayout(board([parent, child1, child2, child3]), new Set([1]));

    const node3 = result.nodes.find((n) => n.id === "wi-3");
    const node4 = result.nodes.find((n) => n.id === "wi-4");
    expect(node3).toBeDefined();
    expect(node4).toBeDefined();
    if (!node3 || !node4) {
      throw new Error("child nodes not found");
    }

    expect(node4.position.y).toBe(node3.position.y);
  });

  it("widens the parent group for multi-column children", () => {
    /*
     *  Single-column (no deps):      Multi-column (with deps):
     *  ┌── PBI 10 ──┐               ┌───── PBI 1 ─────────┐
     *  │  [11]       │               │  [2] ──→ [3]        │
     *  │  [12]       │               └─────────────────────┘
     *  └────────────┘                wider due to 2 columns
     */
    const parent = generateWorkItem({
      id: 1,
      children: [2, 3],
      work_item_type: "Product Backlog Item",
    });
    const child1 = generateWorkItem({ id: 2, parent_id: 1, successors: [3] });
    const child2 = generateWorkItem({ id: 3, parent_id: 1, predecessors: [2] });

    const singleCol = buildGraphLayout(
      board([
        generateWorkItem({ id: 10, children: [11, 12], work_item_type: "Product Backlog Item" }),
        generateWorkItem({ id: 11, parent_id: 10 }),
        generateWorkItem({ id: 12, parent_id: 10 }),
      ]),
      new Set([10]),
    );
    const multiCol = buildGraphLayout(board([parent, child1, child2]), new Set([1]));

    const singleGroup = singleCol.nodes.find((n) => n.id === "group-10");
    const multiGroup = multiCol.nodes.find((n) => n.id === "group-1");
    expect(singleGroup).toBeDefined();
    expect(multiGroup).toBeDefined();
    if (!singleGroup || !multiGroup) {
      throw new Error("group nodes not found");
    }

    const singleWidth = Number(singleGroup.style?.width);
    const multiWidth = Number(multiGroup.style?.width);
    expect(singleWidth).toBeGreaterThan(0);
    expect(multiWidth).toBeGreaterThan(singleWidth);
  });

  it("handles a three-node chain across three columns", () => {
    /*
     *  ┌─── PBI 1 (expanded) ──────────────────┐
     *  │  [2] ──→ [3] ──→ [4]                  │
     *  └───────────────────────────────────────┘
     *  col 0      col 1      col 2
     */
    const parent = generateWorkItem({
      id: 1,
      children: [2, 3, 4],
      work_item_type: "Product Backlog Item",
    });
    const a = generateWorkItem({ id: 2, parent_id: 1, successors: [3] });
    const b = generateWorkItem({ id: 3, parent_id: 1, predecessors: [2], successors: [4] });
    const c = generateWorkItem({ id: 4, parent_id: 1, predecessors: [3] });

    const result = buildGraphLayout(board([parent, a, b, c]), new Set([1]));

    const nodeA = result.nodes.find((n) => n.id === "wi-2");
    const nodeB = result.nodes.find((n) => n.id === "wi-3");
    const nodeC = result.nodes.find((n) => n.id === "wi-4");
    expect(nodeA).toBeDefined();
    expect(nodeB).toBeDefined();
    expect(nodeC).toBeDefined();
    if (!nodeA || !nodeB || !nodeC) {
      throw new Error("chain nodes not found");
    }

    expect(nodeB.position.x).toBeGreaterThan(nodeA.position.x);
    expect(nodeC.position.x).toBeGreaterThan(nodeB.position.x);
  });

  it("lays out grandchildren in columns inside a nested expanded group", () => {
    /*
     *  ┌─── PBI 1 (expanded) ──────────────────────┐
     *  │  ┌─── PBI 2 (expanded) ───┐               │
     *  │  │  [3] ──→ [4]           │               │
     *  │  └────────────────────────┘               │
     *  └──────────────────────────────────────────┘
     *  Grandchildren 3 & 4 laid out in columns inside nested group
     */
    const grandparent = generateWorkItem({
      id: 1,
      children: [2],
      work_item_type: "Product Backlog Item",
    });
    const parent = generateWorkItem({
      id: 2,
      parent_id: 1,
      children: [3, 4],
      work_item_type: "Product Backlog Item",
    });
    const grandchild1 = generateWorkItem({ id: 3, parent_id: 2, successors: [4] });
    const grandchild2 = generateWorkItem({ id: 4, parent_id: 2, predecessors: [3] });

    const result = buildGraphLayout(
      board([grandparent, parent, grandchild1, grandchild2]),
      new Set([1, 2]),
    );

    const gc1 = result.nodes.find((n) => n.id === "wi-3");
    const gc2 = result.nodes.find((n) => n.id === "wi-4");
    expect(gc1).toBeDefined();
    expect(gc2).toBeDefined();
    if (!gc1 || !gc2) {
      throw new Error("grandchild nodes not found");
    }

    expect(gc2.position.x).toBeGreaterThan(gc1.position.x);
  });
});
