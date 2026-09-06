import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import type { Point } from "../types";
import type { NodePosition } from "./graphLayout";
import { SUB_COLUMN_WIDTH } from "./graphLayout";
import {
  routeEdgeSimple,
  routeRightToLeftEdge,
  buildRoundedPath,
  assignLaneOffsets,
  OVERHEAD_LANE_Y,
} from "./edgeRouting";
import {
  buildObstacles,
  segmentBlockedByObstacles,
  buildWaypointGraph,
  orthogonalAStar,
  shiftVerticalsLeft,
  separateOverlappingSegments,
  routeAllEdges,
  OBSTACLE_PADDING,
  TURN_PENALTY,
} from "./pathfinding";
import type { Obstacle, RouteResult } from "./pathfinding";
import { BOARD_NODE_TYPES } from "../types/graph";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePath(path: string): Point[] {
  const points: Point[] = [];
  const re = /([MLQ])\s*([\d.e+-]+)\s+([\d.e+-]+)(?:\s+([\d.e+-]+)\s+([\d.e+-]+))?/g;
  let match;
  while ((match = re.exec(path)) !== null) {
    const cmd = match[1];
    if (cmd === "M" || cmd === "L") {
      points.push({ x: Number(match[2]), y: Number(match[3]) });
    } else if (cmd === "Q") {
      points.push({ x: Number(match[4]), y: Number(match[5]) });
    }
  }
  return points;
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target, type: "dependency" };
}

function makeNodePosition(
  x: number,
  y: number,
  width = SUB_COLUMN_WIDTH,
  height = 80,
): NodePosition {
  return { x, y, width, height, type: BOARD_NODE_TYPES.workItem };
}

// ── buildObstacles ───────────────────────────────────────────────────────────

describe("buildObstacles", () => {
  it("excludes source and target nodes", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["wi-src", makeNodePosition(0, 100)],
      ["wi-dst", makeNodePosition(400, 100)],
      ["wi-blocker", makeNodePosition(200, 100)],
    ]);
    const obstacles = buildObstacles(nodePositions, new Set(["wi-src", "wi-dst"]));
    expect(obstacles).toHaveLength(1);
    expect(obstacles[0].id).toBe("wi-blocker");
  });

  it("applies OBSTACLE_PADDING to all sides", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["wi-n", makeNodePosition(100, 200, 280)],
    ]);
    const obstacles = buildObstacles(nodePositions, new Set());
    expect(obstacles[0].left).toBe(100 - OBSTACLE_PADDING);
    expect(obstacles[0].right).toBe(100 + 280 + OBSTACLE_PADDING);
  });
});

// ── segmentBlockedByObstacles ────────────────────────────────────────────────

describe("segmentBlockedByObstacles", () => {
  const obstacles: Obstacle[] = [{ id: "obs", left: 100, top: 100, right: 300, bottom: 200 }];

  it("detects horizontal segment crossing obstacle", () => {
    expect(segmentBlockedByObstacles({ x: 50, y: 150 }, { x: 350, y: 150 }, obstacles)).toBe(true);
  });

  it("allows horizontal segment above obstacle", () => {
    expect(segmentBlockedByObstacles({ x: 50, y: 50 }, { x: 350, y: 50 }, obstacles)).toBe(false);
  });

  it("detects vertical segment crossing obstacle", () => {
    expect(segmentBlockedByObstacles({ x: 200, y: 50 }, { x: 200, y: 250 }, obstacles)).toBe(true);
  });

  it("allows vertical segment left of obstacle", () => {
    expect(segmentBlockedByObstacles({ x: 50, y: 50 }, { x: 50, y: 250 }, obstacles)).toBe(false);
  });
});

// ── orthogonalAStar ──────────────────────────────────────────────────────────

describe("orthogonalAStar", () => {
  it("finds a direct path between source and target", () => {
    const source: Point = { x: 0, y: 100 };
    const target: Point = { x: 400, y: 100 };
    const graph = buildWaypointGraph([], source, target, 600);
    const result = orthogonalAStar(graph, 0, 1, TURN_PENALTY);
    expect(result.path.length).toBeGreaterThanOrEqual(2);
    expect(result.path[0]).toEqual(source);
    expect(result.path[result.path.length - 1]).toEqual(target);
    expect(result.turns).toBe(0);
  });

  it("routes around an obstacle with turns", () => {
    const source: Point = { x: 0, y: 140 };
    const target: Point = { x: 400, y: 140 };
    const obstacles: Obstacle[] = [{ id: "obs", left: 150, top: 100, right: 250, bottom: 200 }];
    const graph = buildWaypointGraph(obstacles, source, target, 600);
    const result = orthogonalAStar(graph, 0, 1, TURN_PENALTY);
    expect(result.path.length).toBeGreaterThan(2);
    expect(result.turns).toBeGreaterThan(0);
  });

  it("returns empty path when no route exists", () => {
    // Source and target with no visibility edges
    const graph = {
      waypoints: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      edges: [],
    };
    const result = orthogonalAStar(graph, 0, 1, TURN_PENALTY);
    expect(result.path).toHaveLength(0);
  });
});

// ── shiftVerticalsLeft ───────────────────────────────────────────────────────

describe("shiftVerticalsLeft", () => {
  it("returns short paths unchanged", () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(shiftVerticalsLeft(path, [])).toEqual(path);
  });

  it("converts 3-point L-shape to Z-shape", () => {
    const path: Point[] = [
      { x: 0, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 200 },
    ];
    const result = shiftVerticalsLeft(path, []);
    // Should have 4 points (Z-shape)
    expect(result.length).toBe(4);
    // First point unchanged
    expect(result[0]).toEqual({ x: 0, y: 100 });
    // Last point unchanged
    expect(result[result.length - 1]).toEqual({ x: 400, y: 200 });
    // Vertical should be left of x=400
    expect(result[1].x).toBeLessThan(400);
    expect(result[2].x).toBe(result[1].x);
  });

  it("shifts terminal vertical left", () => {
    const path: Point[] = [
      { x: 0, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 150 },
      { x: 500, y: 150 },
      { x: 500, y: 100 },
    ];
    const result = shiftVerticalsLeft(path, []);
    // Terminal vertical at x=500 should be shifted left
    const lastVerticalX = result[result.length - 2].x;
    expect(lastVerticalX).toBeLessThan(500);
  });
});

// ── separateOverlappingSegments ──────────────────────────────────────────────

describe("separateOverlappingSegments", () => {
  it("does nothing when no segments overlap", () => {
    const routes: RouteResult[] = [
      {
        edge: makeEdge("e1", "a", "b"),
        path: [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 200 },
          { x: 200, y: 200 },
        ],
        sourceId: "a",
        targetId: "b",
      },
      {
        edge: makeEdge("e2", "c", "d"),
        path: [
          { x: 0, y: 300 },
          { x: 100, y: 300 },
          { x: 100, y: 400 },
          { x: 200, y: 400 },
        ],
        sourceId: "c",
        targetId: "d",
      },
    ];
    const before = routes.map((r) => r.path.map((p) => ({ ...p })));
    separateOverlappingSegments(routes);
    // Paths should be unchanged
    routes.forEach((r, i) => {
      r.path.forEach((p, j) => {
        expect(p.x).toBe(before[i][j].x);
        expect(p.y).toBe(before[i][j].y);
      });
    });
  });

  it("allows overlap when edges share a source", () => {
    const routes: RouteResult[] = [
      {
        edge: makeEdge("e1", "a", "b"),
        path: [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 200 },
          { x: 200, y: 200 },
        ],
        sourceId: "a",
        targetId: "b",
      },
      {
        edge: makeEdge("e2", "a", "c"),
        path: [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 300 },
          { x: 200, y: 300 },
        ],
        sourceId: "a",
        targetId: "c",
      },
    ];
    const before = routes.map((r) => r.path.map((p) => ({ ...p })));
    separateOverlappingSegments(routes);
    // First segments (shared source) should be unchanged
    expect(routes[0].path[0]).toEqual(before[0][0]);
    expect(routes[1].path[0]).toEqual(before[1][0]);
  });

  it("separates overlapping interior segments from different edges", () => {
    const routes: RouteResult[] = [
      {
        edge: makeEdge("e1", "a", "b"),
        path: [
          { x: 0, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 300 },
          { x: 400, y: 300 },
        ],
        sourceId: "a",
        targetId: "b",
      },
      {
        edge: makeEdge("e2", "c", "d"),
        path: [
          { x: 0, y: 200 },
          { x: 200, y: 200 },
          { x: 200, y: 400 },
          { x: 400, y: 400 },
        ],
        sourceId: "c",
        targetId: "d",
      },
    ];
    separateOverlappingSegments(routes);
    // Vertical segments at x=200 should now have different X values
    expect(routes[0].path[1].x).not.toBe(routes[1].path[1].x);
  });
});

// ── routeAllEdges ────────────────────────────────────────────────────────────

describe("routeAllEdges", () => {
  it("routes a simple edge with no obstacles", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["src", makeNodePosition(0, 100)],
      ["dst", makeNodePosition(400, 100)],
    ]);
    const edges: Edge[] = [makeEdge("e1", "src", "dst")];
    const results = routeAllEdges(edges, nodePositions, 800);
    expect(results).toHaveLength(1);
    expect(results[0].path.length).toBeGreaterThanOrEqual(2);
    // Path should end at target.x (with HANDLE_OFFSET finalized)
    const lastPoint = results[0].path[results[0].path.length - 1];
    expect(lastPoint.x).toBe(400);
  });

  it("returns empty path when node positions are missing", () => {
    const edges: Edge[] = [makeEdge("e1", "unknown", "dst")];
    const results = routeAllEdges(edges, new Map(), 800);
    expect(results[0].path).toHaveLength(0);
  });
});

// ── buildRoundedPath ─────────────────────────────────────────────────────────

describe("buildRoundedPath", () => {
  it("returns empty for fewer than 2 points", () => {
    expect(buildRoundedPath([])).toBe("");
    expect(buildRoundedPath([{ x: 0, y: 0 }])).toBe("");
  });

  it("returns straight line for 2 points", () => {
    const result = buildRoundedPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(result).toBe("M 0 0 L 100 0");
  });

  it("uses Q commands for corners with 3+ points", () => {
    const result = buildRoundedPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(result).toContain("Q");
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

// ── routeRightToLeftEdge ─────────────────────────────────────────────────────

describe("routeRightToLeftEdge", () => {
  it("renders valid SVG path with overhead routing", () => {
    const path = routeRightToLeftEdge({ x: 600, y: 100 }, { x: 200, y: 300 }, 0);
    expect(path).toMatch(/^M /);
    expect(path).toContain(String(OVERHEAD_LANE_Y));
  });
});

// ── assignLaneOffsets ────────────────────────────────────────────────────────

describe("assignLaneOffsets", () => {
  it("assigns path data to each forward edge", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["a", makeNodePosition(0, 100)],
      ["b", makeNodePosition(400, 100)],
    ]);
    const edges: Edge[] = [makeEdge("e1", "a", "b")];
    const result = assignLaneOffsets(edges, nodePositions);
    expect(result).toHaveLength(1);
    expect(result[0].data).toHaveProperty("path");
    expect(typeof result[0].data?.path).toBe("string");
    expect(result[0].data?.path).toContain("M");
  });

  it("returns edges with empty path when node positions are missing", () => {
    const edges: Edge[] = [makeEdge("e1", "a", "b")];
    const result = assignLaneOffsets(edges, new Map());
    expect(result).toHaveLength(1);
  });

  it("assigns laneOffset to backward edges", () => {
    const nodePositions = new Map<string, NodePosition>([
      ["a", makeNodePosition(400, 100)],
      ["b", makeNodePosition(0, 100)],
    ]);
    const edges: Edge[] = [makeEdge("e1", "a", "b")];
    const result = assignLaneOffsets(edges, nodePositions);
    expect(result).toHaveLength(1);
    expect(result[0].data).toHaveProperty("laneOffset");
    expect(result[0].data).toHaveProperty("path");
  });

  it("handles empty edge array", () => {
    const result = assignLaneOffsets([], new Map());
    expect(result).toEqual([]);
  });
});
