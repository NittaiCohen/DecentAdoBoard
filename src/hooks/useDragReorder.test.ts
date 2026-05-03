import type { Node } from "@xyflow/react";
import type { WorkItem } from "../types";
import {
  buildDragStartNodes,
  buildDragStartState,
  buildDragStopNodes,
  buildSlotPositions,
  collectSuccessorChain,
  computeInsertIndex,
  extractWorkItemId,
  type DragState,
} from "./useDragReorder";
import { NODE_GAP_Y, NODE_HEIGHT } from "../utils/graphLayout";
import { generateWorkItem } from "../utils/test-helpers";

const mockNode = (id: string, x = 0, y = 0): Node => ({
  id,
  position: { x, y },
  data: {},
});

const generateDragState = (overrides: Partial<DragState> = {}): DragState => {
  const siblings = overrides.siblings ?? [
    { id: "wi-1", origY: 100, height: NODE_HEIGHT },
    { id: "wi-2", origY: 200, height: NODE_HEIGHT },
    { id: "wi-3", origY: 300, height: NODE_HEIGHT },
  ];

  return {
    draggedId: "wi-dragged",
    draggedParent: undefined,
    draggedOrigX: 0,
    draggedOrigY: 100,
    columnX: 0,
    draggedHeight: NODE_HEIGHT,
    draggedWidth: 280,
    siblings,
    siblingById: new Map(siblings.map((sibling) => [sibling.id, sibling])),
    baseY: 100,
    successorIds: new Set(),
    successorOriginalX: new Map(),
    xLocked: false,
    lastInsertIdx: -1,
    lastSlotPositions: new Map(),
    ...overrides,
  };
};

describe("extractWorkItemId", () => {
  it("extracts numeric ids from work item and group node ids", () => {
    expect(extractWorkItemId("wi-123")).toBe(123);
    expect(extractWorkItemId("group-456")).toBe(456);
    expect(extractWorkItemId("wi-0")).toBe(0);
    expect(extractWorkItemId("group-123")).toBe(123);
  });

  it("returns undefined for unsupported or empty ids", () => {
    expect(extractWorkItemId("other-123")).toBeUndefined();
    expect(extractWorkItemId("")).toBeUndefined();
  });

  it("returns NaN when the numeric part is missing", () => {
    expect(Number.isNaN(extractWorkItemId("wi-"))).toBe(true);
  });
});

describe("collectSuccessorChain", () => {
  it("collects a simple successor chain and prefers group nodes when present", () => {
    const workItemMap = new Map<number, WorkItem>([
      [1, generateWorkItem({ id: 1, successors: [2] })],
      [2, generateWorkItem({ id: 2, successors: [3] })],
      [3, generateWorkItem({ id: 3 })],
    ]);
    const nodeMap = new Map<string, Node>([
      ["wi-2", mockNode("wi-2")],
      ["group-3", mockNode("group-3")],
    ]);

    expect(collectSuccessorChain(1, workItemMap, nodeMap)).toEqual(new Set(["wi-2", "group-3"]));
  });

  it("returns an empty set when there are no successors", () => {
    const workItemMap = new Map<number, WorkItem>([[1, generateWorkItem({ id: 1 })]]);
    const nodeMap = new Map<string, Node>([["wi-1", mockNode("wi-1")]]);

    expect(collectSuccessorChain(1, workItemMap, nodeMap)).toEqual(new Set());
  });

  it("collects all direct successors from branching chains", () => {
    const workItemMap = new Map<number, WorkItem>([
      [1, generateWorkItem({ id: 1, successors: [2, 3] })],
      [2, generateWorkItem({ id: 2 })],
      [3, generateWorkItem({ id: 3 })],
    ]);
    const nodeMap = new Map<string, Node>([
      ["wi-2", mockNode("wi-2")],
      ["wi-3", mockNode("wi-3")],
    ]);

    expect(collectSuccessorChain(1, workItemMap, nodeMap)).toEqual(new Set(["wi-2", "wi-3"]));
  });

  it("ignores disconnected chains", () => {
    const workItemMap = new Map<number, WorkItem>([
      [1, generateWorkItem({ id: 1, successors: [2] })],
      [2, generateWorkItem({ id: 2 })],
      [3, generateWorkItem({ id: 3, successors: [4] })],
      [4, generateWorkItem({ id: 4 })],
    ]);
    const nodeMap = new Map<string, Node>([
      ["wi-2", mockNode("wi-2")],
      ["wi-4", mockNode("wi-4")],
    ]);

    expect(collectSuccessorChain(1, workItemMap, nodeMap)).toEqual(new Set(["wi-2"]));
  });
});

describe("buildSlotPositions", () => {
  it("places the ghost at the top when inserting at index 0", () => {
    const state = generateDragState();

    const { ghostY, slotPositions } = buildSlotPositions(state, 0);

    expect(ghostY).toBe(state.baseY);
    expect(slotPositions).toEqual(
      new Map([
        ["wi-1", state.baseY + NODE_HEIGHT + NODE_GAP_Y],
        ["wi-2", state.baseY + 2 * (NODE_HEIGHT + NODE_GAP_Y)],
        ["wi-3", state.baseY + 3 * (NODE_HEIGHT + NODE_GAP_Y)],
      ]),
    );
  });

  it("places the ghost between siblings when inserting in the middle", () => {
    const state = generateDragState();

    const { ghostY, slotPositions } = buildSlotPositions(state, 2);

    expect(ghostY).toBe(state.baseY + 2 * (NODE_HEIGHT + NODE_GAP_Y));
    expect(slotPositions).toEqual(
      new Map([
        ["wi-1", state.baseY],
        ["wi-2", state.baseY + NODE_HEIGHT + NODE_GAP_Y],
        ["wi-3", state.baseY + 3 * (NODE_HEIGHT + NODE_GAP_Y)],
      ]),
    );
  });

  it("places the ghost at the bottom when inserting at the last position", () => {
    const state = generateDragState();

    const { ghostY, slotPositions } = buildSlotPositions(state, state.siblings.length);

    expect(ghostY).toBe(state.baseY + 3 * (NODE_HEIGHT + NODE_GAP_Y));
    expect(slotPositions).toEqual(
      new Map([
        ["wi-1", state.baseY],
        ["wi-2", state.baseY + NODE_HEIGHT + NODE_GAP_Y],
        ["wi-3", state.baseY + 2 * (NODE_HEIGHT + NODE_GAP_Y)],
      ]),
    );
  });

  it("supports a single sibling inserted at the top", () => {
    const state = generateDragState({
      siblings: [{ id: "wi-1", origY: 100, height: NODE_HEIGHT }],
      baseY: 100,
    });

    const { ghostY, slotPositions } = buildSlotPositions(state, 0);

    expect(ghostY).toBe(100);
    expect(slotPositions).toEqual(new Map([["wi-1", 100 + NODE_HEIGHT + NODE_GAP_Y]]));
  });

  it("supports an empty sibling list", () => {
    const state = generateDragState({ siblings: [], siblingById: new Map(), baseY: 160 });

    const { ghostY, slotPositions } = buildSlotPositions(state, 0);

    expect(ghostY).toBe(160);
    expect(slotPositions).toEqual(new Map());
  });
});

describe("computeInsertIndex", () => {
  it("returns 0 when the dragged node is above all siblings", () => {
    const state = generateDragState();

    expect(computeInsertIndex(state, mockNode("wi-dragged", 0, -100))).toBe(0);
  });

  it("returns the sibling count when the dragged node is below all siblings", () => {
    const state = generateDragState();

    expect(computeInsertIndex(state, mockNode("wi-dragged", 0, 350))).toBe(state.siblings.length);
  });

  it("returns the middle insert index when the dragged node is between sibling two and three", () => {
    const state = generateDragState();

    expect(computeInsertIndex(state, mockNode("wi-dragged", 0, 250))).toBe(2);
  });
});

// --- Drag lifecycle tests ---

describe("buildDragStartNodes", () => {
  it("adds a ghost node", () => {
    const nodes: Node[] = [
      { ...mockNode("wi-1", 0, 100), draggable: true },
      { ...mockNode("wi-2", 0, 200), draggable: true },
      { ...mockNode("wi-dragged", 0, 0), draggable: true },
    ];
    const draggedNode = nodes[2];

    const state = generateDragState({
      siblings: [
        { id: "wi-1", origY: 100, height: NODE_HEIGHT },
        { id: "wi-2", origY: 200, height: NODE_HEIGHT },
      ],
      siblingById: new Map([
        ["wi-1", { id: "wi-1", origY: 100, height: NODE_HEIGHT }],
        ["wi-2", { id: "wi-2", origY: 200, height: NODE_HEIGHT }],
      ]),
    });

    const result = buildDragStartNodes(nodes, state, draggedNode);

    const ghost = result.find((n) => n.id === "__drag-ghost__");
    expect(ghost).toBeDefined();
    if (!ghost) {
      throw new Error("ghost node not found");
    }
    expect(ghost.type).toBe("dragGhost");
    expect(ghost.draggable).toBe(false);
    expect(ghost.selectable).toBe(false);
    expect(result).toHaveLength(4);
  });

  it("marks siblings with transition class", () => {
    const nodes: Node[] = [
      { ...mockNode("wi-1", 0, 100), draggable: true },
      { ...mockNode("wi-2", 0, 200), draggable: true },
      { ...mockNode("wi-dragged", 0, 0), draggable: true },
    ];
    const draggedNode = nodes[2];

    const state = generateDragState({
      siblings: [
        { id: "wi-1", origY: 100, height: NODE_HEIGHT },
        { id: "wi-2", origY: 200, height: NODE_HEIGHT },
      ],
      siblingById: new Map([
        ["wi-1", { id: "wi-1", origY: 100, height: NODE_HEIGHT }],
        ["wi-2", { id: "wi-2", origY: 200, height: NODE_HEIGHT }],
      ]),
    });

    const result = buildDragStartNodes(nodes, state, draggedNode);

    const sib1 = result.find((n) => n.id === "wi-1");
    expect(sib1).toBeDefined();
    if (!sib1) {
      throw new Error("sib1 not found");
    }
    expect(sib1.className).toContain("transition");
  });
});

describe("buildDragStopNodes", () => {
  it("removes the ghost node and clears transition classes", () => {
    const ghostNode = {
      ...mockNode("__drag-ghost__", 0, 100),
      type: "dragGhost",
      draggable: false,
      selectable: false,
    };
    const nodes: Node[] = [
      { ...mockNode("wi-1", 0, 100), className: "transition-[transform] duration-200 ease-out" },
      { ...mockNode("wi-2", 0, 200), className: "transition-[transform] duration-200 ease-out" },
      { ...mockNode("wi-dragged", 0, 150) },
      ghostNode,
    ];
    const state = generateDragState({
      draggedId: "wi-dragged",
      draggedOrigX: 0,
      draggedOrigY: 0,
      columnX: 0,
      baseY: 100,
      siblings: [
        { id: "wi-1", origY: 100, height: NODE_HEIGHT },
        { id: "wi-2", origY: 200, height: NODE_HEIGHT },
      ],
      siblingById: new Map([
        ["wi-1", { id: "wi-1", origY: 100, height: NODE_HEIGHT }],
        ["wi-2", { id: "wi-2", origY: 200, height: NODE_HEIGHT }],
      ]),
      lastInsertIdx: 1,
    });

    const draggedNode = mockNode("wi-dragged", 0, 150);
    const result = buildDragStopNodes(nodes, state, draggedNode);

    expect(result.find((n) => n.id === "__drag-ghost__")).toBeUndefined();
    for (const node of result) {
      expect(node.className).toBeUndefined();
    }
    expect(result).toHaveLength(3);
  });

  it("sets final positions after reorder", () => {
    const ghostNode = {
      ...mockNode("__drag-ghost__", 0, 100),
      type: "dragGhost",
      draggable: false,
      selectable: false,
    };
    const nodes: Node[] = [
      { ...mockNode("wi-1", 0, 100), className: "transition-[transform] duration-200 ease-out" },
      { ...mockNode("wi-2", 0, 200), className: "transition-[transform] duration-200 ease-out" },
      { ...mockNode("wi-dragged", 0, 150) },
      ghostNode,
    ];
    const state = generateDragState({
      draggedId: "wi-dragged",
      draggedOrigX: 0,
      draggedOrigY: 0,
      columnX: 0,
      baseY: 100,
      siblings: [
        { id: "wi-1", origY: 100, height: NODE_HEIGHT },
        { id: "wi-2", origY: 200, height: NODE_HEIGHT },
      ],
      siblingById: new Map([
        ["wi-1", { id: "wi-1", origY: 100, height: NODE_HEIGHT }],
        ["wi-2", { id: "wi-2", origY: 200, height: NODE_HEIGHT }],
      ]),
      lastInsertIdx: 1,
    });

    const draggedNode = mockNode("wi-dragged", 0, 150);
    const result = buildDragStopNodes(nodes, state, draggedNode);

    const wi1 = result.find((n) => n.id === "wi-1");
    const dragged = result.find((n) => n.id === "wi-dragged");
    const wi2 = result.find((n) => n.id === "wi-2");
    expect(wi1).toBeDefined();
    expect(dragged).toBeDefined();
    expect(wi2).toBeDefined();
    if (!wi1 || !dragged || !wi2) {
      throw new Error("expected nodes not found");
    }

    expect(wi1.position.y).toBe(100);
    expect(dragged.position.y).toBe(100 + NODE_HEIGHT + NODE_GAP_Y);
    expect(wi2.position.y).toBe(100 + 2 * (NODE_HEIGHT + NODE_GAP_Y));
  });

  it("handles null state gracefully (removes ghost, clears classes)", () => {
    const nodes: Node[] = [
      { ...mockNode("wi-1", 0, 100), className: "transition-[transform] duration-200 ease-out" },
      { ...mockNode("__drag-ghost__", 0, 50) },
    ];
    const draggedNode = mockNode("wi-1", 0, 100);

    const result = buildDragStopNodes(nodes, null, draggedNode);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("wi-1");
    expect(result[0].className).toBeUndefined();
  });
});

describe("buildDragStartState", () => {
  it("computes drag state with correct node and sibling information", () => {
    const wiMap = new Map<number, WorkItem>([
      [1, generateWorkItem({ id: 1, predecessors: [], successors: [2] })],
      [2, generateWorkItem({ id: 2, predecessors: [1], successors: [] })],
      [3, generateWorkItem({ id: 3, predecessors: [], successors: [] })],
    ]);
    const wiMapRef = { current: wiMap };

    const nodes: Node[] = [
      { ...mockNode("wi-1", 100, 100), draggable: true },
      { ...mockNode("wi-2", 100, 200), draggable: true },
      { ...mockNode("wi-3", 100, 300), draggable: true },
    ];

    const draggedNode = nodes[0];

    const state = buildDragStartState(nodes, draggedNode, wiMapRef);

    expect(state.draggedId).toBe("wi-1");
    expect(state.draggedOrigX).toBe(100);
    expect(state.draggedOrigY).toBe(100);

    expect(state.siblings).toHaveLength(2);
    expect(state.siblings.map((s) => s.id)).toContain("wi-2");
    expect(state.siblings.map((s) => s.id)).toContain("wi-3");
  });

  it("computes successor chain and their original positions", () => {
    const wiMap = new Map<number, WorkItem>([
      [1, generateWorkItem({ id: 1, predecessors: [], successors: [2] })],
      [2, generateWorkItem({ id: 2, predecessors: [1], successors: [] })],
      [3, generateWorkItem({ id: 3, predecessors: [], successors: [] })],
    ]);
    const wiMapRef = { current: wiMap };

    const nodes: Node[] = [
      { ...mockNode("wi-1", 100, 100), draggable: true },
      { ...mockNode("wi-2", 100, 200), draggable: true },
      { ...mockNode("wi-3", 100, 300), draggable: true },
    ];

    const draggedNode = nodes[0];

    const state = buildDragStartState(nodes, draggedNode, wiMapRef);

    expect(state.successorIds.has("wi-2")).toBe(true);
    expect(state.successorOriginalX.get("wi-2")).toBe(100);
    expect(state.xLocked).toBe(false);
    expect(state.baseY).toBe(100);
    expect(state.lastInsertIdx).toBe(-1);
  });

  it("sets xLocked when dragged item has a predecessor in the same column", () => {
    const wiMap = new Map<number, WorkItem>([
      [1, generateWorkItem({ id: 1, predecessors: [], successors: [2] })],
      [2, generateWorkItem({ id: 2, predecessors: [1], successors: [] })],
    ]);
    const wiMapRef = { current: wiMap };

    const nodes: Node[] = [
      { ...mockNode("wi-1", 100, 100), draggable: true },
      { ...mockNode("wi-2", 100, 200), draggable: true },
    ];

    // Dragging wi-2, which has predecessor wi-1 in the same column
    const state = buildDragStartState(nodes, nodes[1], wiMapRef);

    expect(state.draggedId).toBe("wi-2");
    expect(state.xLocked).toBe(true);
  });

  it("handles dragging a node with no work item mapping", () => {
    const wiMap = new Map<number, WorkItem>();
    const wiMapRef = { current: wiMap };

    const nodes: Node[] = [
      { ...mockNode("wi-99", 100, 100), draggable: true },
      { ...mockNode("wi-100", 100, 200), draggable: true },
    ];

    const state = buildDragStartState(nodes, nodes[0], wiMapRef);

    // No work item found: xLocked defaults to true, no successors
    expect(state.xLocked).toBe(true);
    expect(state.successorIds.size).toBe(0);
  });
});
