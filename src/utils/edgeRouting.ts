import type { Edge } from "@xyflow/react";
import type { Point } from "../types";
import type { NodePosition } from "./graphLayout";
import { NODE_GAP_X, NODE_HEIGHT, SUB_COLUMN_STRIDE, SUB_COLUMN_WIDTH } from "./graphLayout";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Distance (px) to travel horizontally into the sprint gap before turning vertical. */
export const EXIT_STUB_PX = 30;

/** Y coordinate for the overhead routing lane used by right-to-left (backward) edges. */
export const OVERHEAD_LANE_Y = -40;

/** Total vertical spread (px) across all lanes approaching the same target node. */
export const LANE_SPREAD_PX = 60;

/** Radius (px) for rounding 90-degree corners in edge paths. */
const CORNER_RADIUS = 8;

// ── Types ──────────────────────────────────────────────────────────────────────

export type RoutingStrategy = "elbow-destY" | "elbow-srcY" | "staircase";

export type Segment =
  | { kind: "horizontal"; y: number; start: number; end: number }
  | { kind: "vertical"; x: number; start: number; end: number };

export interface EdgeSegments {
  edge: Edge;
  segments: Segment[];
  strategy: RoutingStrategy;
}

export interface DependencyEdgeData {
  [key: string]: unknown;
  laneOffset?: number;
  routingStrategy?: RoutingStrategy;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getOrCreate<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = new Set<V>();
  map.set(key, value);
  return value;
}

/**
 * Returns true if a horizontal line at `pivotY` spanning from `minX` to `maxX`
 * would cross any node body (excluding the source/destination endpoints).
 */
export function horizontalCrossesNode(
  pivotY: number,
  minX: number,
  maxX: number,
  sourceId: string,
  destinationId: string,
  nodePositions: Map<string, NodePosition>,
): boolean {
  return [...nodePositions.entries()].some(([id, node]) => {
    if (id === sourceId || id === destinationId) {
      return false;
    }
    const horizontallyOverlaps = node.x < maxX && node.x + node.width > minX;
    const verticallyIntersects = node.y < pivotY && node.y + NODE_HEIGHT > pivotY;
    return horizontallyOverlaps && verticallyIntersects;
  });
}

function elbowSegments(
  sourceHandle: Point,
  destinationHandle: Point,
  pivotX: number,
  pivotY: number,
): Segment[] {
  return [
    {
      kind: "horizontal",
      y: sourceHandle.y,
      start: Math.min(sourceHandle.x, pivotX),
      end: Math.max(sourceHandle.x, pivotX),
    },
    {
      kind: "vertical",
      x: pivotX,
      start: Math.min(sourceHandle.y, pivotY),
      end: Math.max(sourceHandle.y, pivotY),
    },
    {
      kind: "horizontal",
      y: pivotY,
      start: Math.min(pivotX, destinationHandle.x),
      end: Math.max(pivotX, destinationHandle.x),
    },
  ];
}

function staircaseSegments(sourceHandle: Point, destinationHandle: Point): Segment[] {
  const N = Math.max(
    1,
    Math.round(
      (destinationHandle.x - sourceHandle.x + SUB_COLUMN_WIDTH - NODE_GAP_X) / SUB_COLUMN_STRIDE,
    ),
  );
  const segments: Segment[] = [];
  let prevX = sourceHandle.x;
  let prevY = sourceHandle.y;
  for (let k = 0; k < N; k++) {
    const gapCenterX = sourceHandle.x + EXIT_STUB_PX + k * SUB_COLUMN_STRIDE;
    const stepY = sourceHandle.y + ((k + 1) / N) * (destinationHandle.y - sourceHandle.y);
    segments.push({
      kind: "horizontal",
      y: prevY,
      start: Math.min(prevX, gapCenterX),
      end: Math.max(prevX, gapCenterX),
    });
    segments.push({
      kind: "vertical",
      x: gapCenterX,
      start: Math.min(prevY, stepY),
      end: Math.max(prevY, stepY),
    });
    prevX = gapCenterX;
    prevY = stepY;
  }
  segments.push({
    kind: "horizontal",
    y: destinationHandle.y,
    start: Math.min(prevX, destinationHandle.x),
    end: Math.max(prevX, destinationHandle.x),
  });
  return segments;
}

// ── Pre-offset segment computation ─────────────────────────────────────────────

export function preOffsetSegments(
  edge: Edge,
  nodePositions: Map<string, NodePosition>,
): EdgeSegments {
  const source = nodePositions.get(edge.source);
  const destination = nodePositions.get(edge.target);
  if (source === undefined || destination === undefined) {
    return { edge, segments: [], strategy: "elbow-destY" };
  }
  const sourceHandle: Point = { x: source.x + source.width, y: source.y + NODE_HEIGHT / 2 };
  const destinationHandle: Point = { x: destination.x, y: destination.y + NODE_HEIGHT / 2 };

  // Strategy 1: 3-segment elbow at destinationHandle.y (preferred)
  const destPivotX = sourceHandle.x + EXIT_STUB_PX;
  if (
    !horizontalCrossesNode(
      destinationHandle.y,
      destPivotX,
      destinationHandle.x,
      edge.source,
      edge.target,
      nodePositions,
    )
  ) {
    return {
      edge,
      segments: elbowSegments(sourceHandle, destinationHandle, destPivotX, destinationHandle.y),
      strategy: "elbow-destY",
    };
  }

  // Strategy 2: 3-segment elbow at sourceHandle.y (alternate)
  const srcPivotX = destinationHandle.x - EXIT_STUB_PX;
  if (
    !horizontalCrossesNode(
      sourceHandle.y,
      sourceHandle.x,
      srcPivotX,
      edge.source,
      edge.target,
      nodePositions,
    )
  ) {
    return {
      edge,
      segments: elbowSegments(sourceHandle, destinationHandle, srcPivotX, sourceHandle.y),
      strategy: "elbow-srcY",
    };
  }

  // Strategy 3: staircase fallback
  return {
    edge,
    segments: staircaseSegments(sourceHandle, destinationHandle),
    strategy: "staircase",
  };
}

// ── Overlap detection ──────────────────────────────────────────────────────────

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

function segmentsOverlap(a: Segment, b: Segment): boolean {
  if (a.kind === "horizontal" && b.kind === "horizontal") {
    return a.y === b.y && rangesOverlap(a, b);
  }
  if (a.kind === "vertical" && b.kind === "vertical") {
    return a.x === b.x && rangesOverlap(a, b);
  }
  return false;
}

// ── SVG path rendering ─────────────────────────────────────────────────────────

/**
 * Builds an SVG path from a list of orthogonal waypoints, rounding each
 * 90-degree corner with a quadratic Bézier curve capped at CORNER_RADIUS.
 */
function buildRoundedPath(waypoints: Point[]): string {
  if (waypoints.length < 2) {
    return "";
  }
  if (waypoints.length === 2) {
    return `M ${waypoints[0].x} ${waypoints[0].y} L ${waypoints[1].x} ${waypoints[1].y}`;
  }

  const parts: string[] = [`M ${waypoints[0].x} ${waypoints[0].y}`];

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const next = waypoints[i + 1];

    // Distance from corner to its neighbours, cap radius
    const dPrev = Math.max(Math.abs(curr.x - prev.x), Math.abs(curr.y - prev.y));
    const dNext = Math.max(Math.abs(next.x - curr.x), Math.abs(next.y - curr.y));
    const r = Math.min(CORNER_RADIUS, dPrev / 2, dNext / 2);

    // Point just before the corner
    const beforeX = curr.x + (r / dPrev) * (prev.x - curr.x);
    const beforeY = curr.y + (r / dPrev) * (prev.y - curr.y);

    // Point just after the corner
    const afterX = curr.x + (r / dNext) * (next.x - curr.x);
    const afterY = curr.y + (r / dNext) * (next.y - curr.y);

    parts.push(`L ${beforeX} ${beforeY}`);
    parts.push(`Q ${curr.x} ${curr.y} ${afterX} ${afterY}`);
  }

  const last = waypoints[waypoints.length - 1];
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(" ");
}

/**
 * Renders a forward (left-to-right) edge as an SVG path string.
 * The strategy determines the shape; laneOffset shifts the pivot Y.
 */
export function routeLeftToRightEdge(
  source: Point,
  destination: Point,
  strategy: RoutingStrategy,
  laneOffset: number,
): string {
  const waypoints: Point[] = [source];
  // Push only if the point differs from the last waypoint — avoids
  // duplicate consecutive points that cause NaN in buildRoundedPath.
  const push = (p: Point) => {
    const last = waypoints[waypoints.length - 1];
    if (last.x !== p.x || last.y !== p.y) {
      waypoints.push(p);
    }
  };

  if (strategy === "elbow-destY") {
    const pivotX = source.x + EXIT_STUB_PX;
    const pivotY = destination.y + laneOffset;
    push({ x: pivotX, y: source.y });
    push({ x: pivotX, y: pivotY });
    if (pivotY !== destination.y) {
      const entryX = destination.x - EXIT_STUB_PX;
      push({ x: entryX, y: pivotY });
      push({ x: entryX, y: destination.y });
    }
    push(destination);
  } else if (strategy === "elbow-srcY") {
    const exitX = source.x + EXIT_STUB_PX;
    const pivotX = destination.x - EXIT_STUB_PX;
    const pivotY = source.y + laneOffset;
    push({ x: exitX, y: source.y });
    if (pivotY !== source.y) {
      push({ x: exitX, y: pivotY });
    }
    push({ x: pivotX, y: pivotY });
    push({ x: pivotX, y: destination.y });
    push(destination);
  } else {
    // staircase
    const N = Math.max(
      1,
      Math.round((destination.x - source.x + SUB_COLUMN_WIDTH - NODE_GAP_X) / SUB_COLUMN_STRIDE),
    );
    let prevY = source.y;
    for (let k = 0; k < N; k++) {
      const gapCenterX = source.x + EXIT_STUB_PX + k * SUB_COLUMN_STRIDE;
      const stepY = source.y + ((k + 1) / N) * (destination.y - source.y) + laneOffset;
      push({ x: gapCenterX, y: prevY });
      push({ x: gapCenterX, y: stepY });
      prevY = stepY;
    }
    if (prevY !== destination.y) {
      const entryX = destination.x - EXIT_STUB_PX;
      push({ x: entryX, y: prevY });
      push({ x: entryX, y: destination.y });
    }
    push(destination);
  }

  return buildRoundedPath(waypoints);
}

/**
 * Renders a backward (right-to-left) edge through the overhead lane.
 */
export function routeRightToLeftEdge(
  source: Point,
  destination: Point,
  laneOffset: number,
): string {
  const exitX = source.x + EXIT_STUB_PX;
  const entryX = destination.x - EXIT_STUB_PX;
  const overheadY = OVERHEAD_LANE_Y + laneOffset;

  return buildRoundedPath([
    source,
    { x: exitX, y: source.y },
    { x: exitX, y: overheadY },
    { x: entryX, y: overheadY },
    { x: entryX, y: destination.y },
    destination,
  ]);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns an SVG path string for the given handle positions, routing strategy,
 * and lane offset.
 */
export function routeEdge(
  source: Point,
  destination: Point,
  strategy: RoutingStrategy,
  laneOffset: number = 0,
): string {
  // Degenerate: same position
  if (source.x === destination.x && source.y === destination.y) {
    return "";
  }

  // Forward (left-to-right) vs backward (right-to-left)
  if (source.x < destination.x) {
    return routeLeftToRightEdge(source, destination, strategy, laneOffset);
  }
  return routeRightToLeftEdge(source, destination, laneOffset);
}

/**
 * Fast-path used during drag — 3-segment elbow at destination handle Y,
 * no lane offset. Always produces a simple 3-segment path.
 */
export function routeEdgeSimple(source: Point, destination: Point): string {
  if (source.x === destination.x && source.y === destination.y) {
    return "";
  }
  if (source.x < destination.x) {
    return routeLeftToRightEdge(source, destination, "elbow-destY", 0);
  }
  return routeRightToLeftEdge(source, destination, 0);
}

/**
 * Recomputes routing strategy and laneOffset for every edge given node positions.
 * Called at initial layout and again after each drag drop.
 */
export function assignLaneOffsets(edges: Edge[], nodePositions: Map<string, NodePosition>): Edge[] {
  // Separate forward and backward edges
  const forwardEdges: Edge[] = [];
  const backwardEdges: Edge[] = [];

  for (const edge of edges) {
    const sourcePos = nodePositions.get(edge.source);
    const targetPos = nodePositions.get(edge.target);
    if (sourcePos === undefined || targetPos === undefined) {
      forwardEdges.push(edge);
      continue;
    }
    if (sourcePos.x < targetPos.x) {
      forwardEdges.push(edge);
    } else {
      backwardEdges.push(edge);
    }
  }

  // Compute pre-offset segments for forward edges (includes strategy selection)
  const forwardEdgeSegs = forwardEdges.map((e) => preOffsetSegments(e, nodePositions));

  // Build overlap adjacency graph
  // Edges that share a source or target converge/diverge naturally — skip them.
  const adjacency = new Map<number, Set<number>>();
  forwardEdgeSegs.forEach(({ segments: segmentsI, edge: edgeI }, i) => {
    forwardEdgeSegs.slice(i + 1).forEach(({ segments: segmentsJ, edge: edgeJ }, offset) => {
      const j = i + 1 + offset;
      if (edgeI.source === edgeJ.source || edgeI.target === edgeJ.target) {
        return;
      }
      if (segmentsI.some((s1) => segmentsJ.some((s2) => segmentsOverlap(s1, s2)))) {
        getOrCreate(adjacency, i).add(j);
        getOrCreate(adjacency, j).add(i);
      }
    });
  });

  // BFS to find connected components = lane groups
  const visited = new Set<number>();
  const forwardLaneGroups: Edge[][] = [];
  forwardEdgeSegs.forEach((_, i) => {
    if (visited.has(i)) {
      return;
    }
    const component: number[] = [];
    const queue = [i];
    while (queue.length > 0) {
      const idx = queue.shift();
      if (idx === undefined) {
        continue;
      }
      if (visited.has(idx)) {
        continue;
      }
      visited.add(idx);
      component.push(idx);
      adjacency.get(idx)?.forEach((neighbor) => queue.push(neighbor));
    }
    forwardLaneGroups.push(component.map((idx) => forwardEdgeSegs[idx].edge));
  });

  // Backward edges share the overhead lane — treat them all as one group
  const allLaneGroups = [
    ...forwardLaneGroups,
    ...(backwardEdges.length > 0 ? [backwardEdges] : []),
  ];

  // Strategy lookup from preOffsetSegments
  const strategyByEdgeId = new Map<string, RoutingStrategy>(
    forwardEdgeSegs.map(({ edge, strategy }) => [edge.id, strategy]),
  );

  // Assign lane offsets within each group
  return allLaneGroups.flatMap((group) => {
    const numOfLanes = group.length;
    const step = LANE_SPREAD_PX / Math.max(1, numOfLanes - 1);
    return group.map((edge, index) => ({
      ...edge,
      data: {
        ...edge.data,
        laneOffset: (index - (numOfLanes - 1) / 2) * step,
        routingStrategy: strategyByEdgeId.get(edge.id) ?? "elbow-destY",
      },
    }));
  });
}
