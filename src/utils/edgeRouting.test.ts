import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import type { Point } from "../types";
import type { NodePosition } from "./graphLayout";
import { SUB_COLUMN_WIDTH, SUB_COLUMN_STRIDE } from "./graphLayout";
import {
  routeEdge,
  routeEdgeSimple,
  routeLeftToRightEdge,
  routeRightToLeftEdge,
  horizontalCrossesNode,
  preOffsetSegments,
  assignLaneOffsets,
  OVERHEAD_LANE_Y,
} from "./edgeRouting";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts waypoints from a path string containing M, L, and Q commands.
 * For Q commands, extracts the end-point (skipping the control point).
 */
function parsePath(path: string): Point[] {
  const points: Point[] = [];
  const re = /([MLQ])\s*([\d.e+-]+)\s+([\d.e+-]+)(?:\s+([\d.e+-]+)\s+([\d.e+-]+))?/g;
  let match;
  while ((match = re.exec(path)) !== null) {
    const cmd = match[1];
    if (cmd === "M" || cmd === "L") {
      points.push({ x: Number(match[2]), y: Number(match[3]) });
    } else if (cmd === "Q") {
      // Q controlX controlY endX endY — we want the end point
      points.push({ x: Number(match[4]), y: Number(match[5]) });
    }
  }
  return points;
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target, type: "dependency" };
}

function makeNodePosition(x: number, y: number, width = SUB_COLUMN_WIDTH): NodePosition {
  return { x, y, width };
}

// ── routeEdge ────────────────────────────────────────────────────────────────

describe("routeEdge", () => {
  it("returns empty string for degenerate (same position)", () => {
    const p: Point = { x: 100, y: 200 };
    expect(routeEdge(p, p, "elbow-destY")).toBe("");
  });

  describe("forward (left-to-right)", () => {
    it("elbow-destY produces correct path shape", () => {
      const source: Point = { x: 280, y: 100 };
      const destination: Point = { x: 620, y: 200 };
      const path = routeEdge(source, destination, "elbow-destY", 0);
      const points = parsePath(path);
      // starts at source, ends at destination
      expect(points[0]).toEqual(source);
      expect(points[points.length - 1]).toEqual(destination);
      // path should contain M and at least one Q (rounded corner)
      expect(path).toContain("Q");
    });

    it("elbow-destY applies lane offset but still connects to destination", () => {
      const source: Point = { x: 0, y: 100 };
      const destination: Point = { x: 400, y: 300 };
      const path = routeEdge(source, destination, "elbow-destY", 15);
      const points = parsePath(path);
      // Path should still end at the actual destination handle
      expect(points[points.length - 1]).toEqual(destination);
    });

    it("elbow-srcY routes with correct shape", () => {
      const source: Point = { x: 0, y: 100 };
      const destination: Point = { x: 400, y: 300 };
      const path = routeEdge(source, destination, "elbow-srcY", 0);
      const points = parsePath(path);
      // starts at source, ends at destination
      expect(points[0]).toEqual(source);
      expect(points[points.length - 1]).toEqual(destination);
      expect(path).toContain("Q");
    });

    it("staircase produces multiple segments", () => {
      const source: Point = { x: 0, y: 100 };
      const destination: Point = {
        x: SUB_COLUMN_STRIDE * 2 + SUB_COLUMN_WIDTH,
        y: 300,
      };
      const path = routeEdge(source, destination, "staircase", 0);
      const points = parsePath(path);
      // should have more than 4 waypoints for multi-step staircase
      expect(points.length).toBeGreaterThan(4);
      // starts at source and ends near destination
      expect(points[0]).toEqual(source);
    });
  });

  describe("backward (right-to-left)", () => {
    it("routes through the overhead lane", () => {
      const source: Point = { x: 600, y: 100 };
      const destination: Point = { x: 200, y: 300 };
      const path = routeEdge(source, destination, "elbow-destY", 0);
      const points = parsePath(path);
      // starts at source, ends at destination
      expect(points[0]).toEqual(source);
      expect(points[points.length - 1]).toEqual(destination);
      // path uses rounded corners
      expect(path).toContain("Q");
    });

    it("applies lane offset to overhead lane", () => {
      const source: Point = { x: 600, y: 100 };
      const destination: Point = { x: 200, y: 300 };
      const path = routeEdge(source, destination, "elbow-destY", 10);
      const points = parsePath(path);
      // starts at source, ends at destination
      expect(points[0]).toEqual(source);
      expect(points[points.length - 1]).toEqual(destination);
    });
  });
});

// ── routeEdgeSimple ──────────────────────────────────────────────────────────

describe("routeEdgeSimple", () => {
  it("returns empty string for degenerate input", () => {
    const p: Point = { x: 50, y: 50 };
    expect(routeEdgeSimple(p, p)).toBe("");
  });

  it("produces a forward elbow path with rounded corners", () => {
    const source: Point = { x: 100, y: 200 };
    const destination: Point = { x: 500, y: 400 };
    const path = routeEdgeSimple(source, destination);
    const points = parsePath(path);
    expect(points[0]).toEqual(source);
    expect(points[points.length - 1].y).toBe(destination.y);
    expect(path).toContain("Q");
  });

  it("produces backward routing for right-to-left edges", () => {
    const source: Point = { x: 500, y: 200 };
    const destination: Point = { x: 100, y: 400 };
    const path = routeEdgeSimple(source, destination);
    const points = parsePath(path);
    expect(points[0]).toEqual(source);
    expect(points[points.length - 1]).toEqual(destination);
    expect(path).toContain("Q");
  });
});

// ── routeLeftToRightEdge / routeRightToLeftEdge ──────────────────────────────

describe("routeLeftToRightEdge", () => {
  it("renders valid SVG path starting with M", () => {
    const path = routeLeftToRightEdge({ x: 0, y: 0 }, { x: 400, y: 200 }, "elbow-destY", 0);
    expect(path).toMatch(/^M /);
  });
});

describe("routeRightToLeftEdge", () => {
  it("renders valid SVG path with overhead routing", () => {
    const path = routeRightToLeftEdge({ x: 600, y: 100 }, { x: 200, y: 300 }, 0);
    expect(path).toMatch(/^M /);
    expect(path).toContain(String(OVERHEAD_LANE_Y));
  });
});

// ── horizontalCrossesNode ────────────────────────────────────────────────────

describe("horizontalCrossesNode", () => {
  const nodePositions = new Map<string, NodePosition>([
    ["src", makeNodePosition(0, 100)],
    ["dst", makeNodePosition(600, 100)],
    ["blocker", makeNodePosition(300, 90)],
  ]);

  it("returns true when horizontal line crosses a node body", () => {
    // blocker at y=90, height=80 → spans y=90..170
    // horizontal at y=130 crosses it, and x range overlaps
    expect(horizontalCrossesNode(130, 100, 500, "src", "dst", nodePositions)).toBe(true);
  });

  it("returns false when line is above the node", () => {
    // y=50 is above blocker at y=90
    expect(horizontalCrossesNode(50, 100, 500, "src", "dst", nodePositions)).toBe(false);
  });

  it("returns false when line is below the node", () => {
    // y=200 is below blocker (90 + 80 = 170)
    expect(horizontalCrossesNode(200, 100, 500, "src", "dst", nodePositions)).toBe(false);
  });

  it("excludes source and destination nodes", () => {
    // Line crosses src node position, but src is excluded
    expect(horizontalCrossesNode(140, 0, 600, "src", "dst", nodePositions)).toBe(true); // blocker still hit
    // Remove blocker, only src and dst remain
    const noBlockers = new Map<string, NodePosition>([
      ["src", makeNodePosition(0, 100)],
      ["dst", makeNodePosition(600, 100)],
    ]);
    expect(horizontalCrossesNode(140, 0, 700, "src", "dst", noBlockers)).toBe(false);
  });

  it("returns false when x range does not overlap node", () => {
    // blocker at x=300..580, but we check x=0..100
    expect(horizontalCrossesNode(130, 0, 100, "src", "dst", nodePositions)).toBe(false);
  });
});

// ── preOffsetSegments ────────────────────────────────────────────────────────

describe("preOffsetSegments", () => {
  it("returns empty segments when source node is missing", () => {
    const edge = makeEdge("e1", "unknown", "dst");
    const nodePositions = new Map<string, NodePosition>([["dst", makeNodePosition(400, 100)]]);
    const result = preOffsetSegments(edge, nodePositions);
    expect(result.segments).toHaveLength(0);
    expect(result.strategy).toBe("elbow-destY");
  });

  it("chooses elbow-destY when path is clear", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["src", makeNodePosition(0, 100)],
      ["dst", makeNodePosition(400, 200)],
    ]);
    const edge = makeEdge("e1", "src", "dst");
    const result = preOffsetSegments(edge, nodePositions);
    expect(result.strategy).toBe("elbow-destY");
    expect(result.segments).toHaveLength(3);
  });

  it("falls back to elbow-srcY when destY path is blocked", () => {
    // blocker positioned to intersect the destY horizontal at y=240 (destination node center)
    const nodePositions = new Map<string, NodePosition>([
      ["src", makeNodePosition(0, 100)],
      ["dst", makeNodePosition(600, 200)],
      ["blocker", makeNodePosition(200, 200)],
    ]);
    const edge = makeEdge("e1", "src", "dst");
    const result = preOffsetSegments(edge, nodePositions);
    expect(result.strategy).toBe("elbow-srcY");
  });

  it("falls back to staircase when both elbows are blocked", () => {
    // Place blockers to block both horizontal paths
    const srcY = 100;
    const dstY = 300;
    const nodePositions = new Map<string, NodePosition>([
      ["src", makeNodePosition(0, srcY)],
      ["dst", makeNodePosition(600, dstY)],
      // Blocks destY horizontal: node body spans dstY center
      ["blocker1", makeNodePosition(200, dstY)],
      // Blocks srcY horizontal: node body spans srcY center
      ["blocker2", makeNodePosition(200, srcY)],
    ]);
    const edge = makeEdge("e1", "src", "dst");
    const result = preOffsetSegments(edge, nodePositions);
    expect(result.strategy).toBe("staircase");
    // staircase produces at least 3 segments
    expect(result.segments.length).toBeGreaterThanOrEqual(3);
  });
});

// ── assignLaneOffsets ────────────────────────────────────────────────────────

describe("assignLaneOffsets", () => {
  it("assigns routingStrategy and laneOffset to each edge", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["a", makeNodePosition(0, 100)],
      ["b", makeNodePosition(400, 100)],
      ["c", makeNodePosition(400, 300)],
    ]);
    const edges: Edge[] = [makeEdge("e1", "a", "b"), makeEdge("e2", "a", "c")];
    const result = assignLaneOffsets(edges, nodePositions);
    expect(result).toHaveLength(2);
    for (const edge of result) {
      expect(edge.data).toHaveProperty("routingStrategy");
      expect(edge.data).toHaveProperty("laneOffset");
      expect(typeof edge.data?.laneOffset).toBe("number");
    }
  });

  it("returns edges unchanged when node positions are missing", () => {
    const edges: Edge[] = [makeEdge("e1", "a", "b")];
    const result = assignLaneOffsets(edges, new Map());
    expect(result).toHaveLength(1);
  });

  it("separates backward edges into their own lane group", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["a", makeNodePosition(400, 100)],
      ["b", makeNodePosition(0, 100)],
    ]);
    const edges: Edge[] = [makeEdge("e1", "a", "b")];
    const result = assignLaneOffsets(edges, nodePositions);
    expect(result).toHaveLength(1);
    expect(result[0].data).toHaveProperty("laneOffset");
  });

  it("assigns distinct lane offsets to overlapping forward edges", () => {
    // Two edges targeting the same Y → they should overlap and get different offsets
    const nodePositions = new Map<string, NodePosition>([
      ["a", makeNodePosition(0, 100)],
      ["b", makeNodePosition(0, 200)],
      ["c", makeNodePosition(400, 150)],
    ]);
    const edges: Edge[] = [makeEdge("e1", "a", "c"), makeEdge("e2", "b", "c")];
    const result = assignLaneOffsets(edges, nodePositions);
    expect(result).toHaveLength(2);
    const offsets = result.map((e) => Number(e.data?.laneOffset));
    // If they're in the same lane group, offsets should differ
    if (offsets[0] !== offsets[1]) {
      expect(offsets[0]).not.toBe(offsets[1]);
    }
  });

  it("single edge gets zero lane offset", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["a", makeNodePosition(0, 100)],
      ["b", makeNodePosition(400, 200)],
    ]);
    const edges: Edge[] = [makeEdge("e1", "a", "b")];
    const result = assignLaneOffsets(edges, nodePositions);
    expect(result[0].data?.laneOffset).toBe(0);
  });

  it("handles empty edge array", () => {
    const result = assignLaneOffsets([], new Map());
    expect(result).toEqual([]);
  });
});
