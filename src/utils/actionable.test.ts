import { computeActionableSet } from "./actionable";
import { generateWorkItem } from "./test-helpers";

describe("computeActionableSet", () => {
  describe("state filtering", () => {
    it("returns an empty set for empty input", () => {
      /*
       *  (no items)
       *  Empty input → empty actionable set
       */
      expect(computeActionableSet([])).toEqual(new Set());
    });

    it("returns the id for a single active item", () => {
      /*
       *  [1 Active]
       *  No predecessors, not done → actionable
       */
      expect(computeActionableSet([generateWorkItem({ id: 1, state: "Active" })])).toEqual(
        new Set([1]),
      );
    });

    it.each(["Done", "Closed", "Resolved", "Removed"])("excludes items in %s state", (state) => {
      /*
       *  [1 <state>]
       *  Terminal state → excluded from actionable set
       */
      expect(computeActionableSet([generateWorkItem({ id: 1, state })])).toEqual(new Set());
    });
  });

  describe("predecessor blocking", () => {
    it("marks an item as actionable when all predecessors are done", () => {
      /*
       *  [1 Done] ──┐
       *             ├──→ [2 New]
       *  [3 Done] ──┘
       *  Both predecessors done → 2 is actionable
       */
      const predecessor1 = generateWorkItem({ id: 1, state: "Done", successors: [2] });
      const predecessor2 = generateWorkItem({ id: 3, state: "Done", successors: [2] });
      const item = generateWorkItem({ id: 2, predecessors: [1, 3] });

      expect(computeActionableSet([predecessor1, item, predecessor2])).toEqual(new Set([2]));
    });

    it("does not mark an item as actionable when any predecessor is not done", () => {
      /*
       *  [1 Done]   ──┐
       *               ├──→ [2 New]
       *  [3 Active] ──┘
       *  Predecessor 3 not done → 2 is blocked
       */
      const donePredecessor = generateWorkItem({ id: 1, state: "Done", successors: [2] });
      const activePredecessor = generateWorkItem({ id: 3, state: "Active", successors: [2] });
      const item = generateWorkItem({ id: 2, predecessors: [1, 3] });

      expect(computeActionableSet([donePredecessor, item, activePredecessor]).has(2)).toBe(false);
    });

    it("treats missing predecessors as not done", () => {
      /*
       *  [999 ???] ──→ [1 New]
       *  Predecessor 999 not in input → treated as not done → 1 blocked
       */
      expect(computeActionableSet([generateWorkItem({ id: 1, predecessors: [999] })])).toEqual(
        new Set(),
      );
    });

    it.each(["Done", "Closed", "Resolved", "Removed"])(
      "treats a %s predecessor as non-blocking",
      (state) => {
        /*
         *  [1 <state>] ──→ [2 New]
         *  Predecessor in terminal state → no longer blocking → 2 is actionable
         */
        const predecessor = generateWorkItem({ id: 1, state, successors: [2] });
        const item = generateWorkItem({ id: 2, predecessors: [1] });

        expect(computeActionableSet([predecessor, item])).toEqual(new Set([2]));
      },
    );
  });

  describe("parent-child propagation", () => {
    it("recursively gates a child on its parent", () => {
      /*
       *  [3 Active] ──→ [1 New]
       *                   └── [2 New]  (child)
       *  Parent 1 blocked by predecessor 3 → child 2 also blocked
       */
      const parent = generateWorkItem({ id: 1, state: "New", children: [2] });
      const child = generateWorkItem({ id: 2, state: "New", parent_id: 1 });

      expect(computeActionableSet([parent, child])).toEqual(new Set([1, 2]));

      const blockedParent = generateWorkItem({
        ...parent,
        predecessors: [3],
      });
      const blockingPred = generateWorkItem({ id: 3, state: "Active", successors: [1] });
      const result = computeActionableSet([blockedParent, child, blockingPred]);

      expect(result.has(1)).toBe(false);
      expect(result.has(2)).toBe(false);
      expect(result.has(3)).toBe(true);
    });

    it("propagates non-actionable state through transitive parents", () => {
      /*
       *  [4 Active] ──→ [1 New]
       *                   └── [2 New]  (child)
       *                         └── [3 New]  (grandchild)
       *  Grandparent 1 blocked by 4 → parent 2 and child 3 also blocked
       */
      const grandparent = generateWorkItem({ id: 1, predecessors: [4], children: [2] });
      const parent = generateWorkItem({ id: 2, parent_id: 1, children: [3] });
      const child = generateWorkItem({ id: 3, parent_id: 2 });
      const blocker = generateWorkItem({ id: 4, state: "Active", successors: [1] });
      const result = computeActionableSet([grandparent, parent, child, blocker]);

      expect(result.has(1)).toBe(false);
      expect(result.has(2)).toBe(false);
      expect(result.has(3)).toBe(false);
      expect(result.has(4)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("does not mark cyclic predecessors as actionable", () => {
      /*
       *  [1 Active] ←──→ [2 Active]
       *  Mutual dependency cycle → neither is actionable
       */
      const item1 = generateWorkItem({
        id: 1,
        state: "Active",
        predecessors: [2],
        successors: [2],
      });
      const item2 = generateWorkItem({
        id: 2,
        state: "Active",
        predecessors: [1],
        successors: [1],
      });

      expect(computeActionableSet([item1, item2])).toEqual(new Set());
    });

    it("returns the exact actionable set for a mixed graph", () => {
      /*
       *  [1 Done] ──→ [2 Active] ──→ [3 New]
       *                 └── [4 New]  (child)
       *  [5 Removed]
       *
       *  1: Done → excluded. 2: Active, predecessor done → actionable.
       *  3: predecessor 2 not done → blocked. 4: child of 2, parent actionable → actionable.
       *  5: Removed → excluded.
       */
      const items = [
        generateWorkItem({ id: 1, state: "Done", successors: [2] }),
        generateWorkItem({
          id: 2,
          state: "Active",
          predecessors: [1],
          successors: [3],
          children: [4],
        }),
        generateWorkItem({ id: 3, state: "New", predecessors: [2] }),
        generateWorkItem({ id: 4, state: "New", parent_id: 2 }),
        generateWorkItem({ id: 5, state: "Removed" }),
      ];

      expect(computeActionableSet(items)).toEqual(new Set([2, 4]));
    });
  });
});
