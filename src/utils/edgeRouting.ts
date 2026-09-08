import type { Edge } from "@xyflow/react";
import type { Point } from "../types";
import type { NodePosition } from "./graphLayout";
import { routeAllEdges } from "./pathfinding";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Distance (px) to travel horizontally into the sprint gap before turning vertical. */
export const EXIT_STUB_PX = 30;

/** Y coordinate for the overhead routing lane used by right-to-left (backward) edges. */
export const OVERHEAD_LANE_Y = -40;

/** Total vertical spread (px) across all lanes approaching the same target node. */
export const LANE_SPREAD_PX = 60;

/** Radius (px) for rounding 90-degree corners in edge paths. */
const CORNER_RADIUS = 8;

/** Extra padding (px) added to the right of the furthest node for routing headroom. */
const ROUTING_RIGHT_PADDING = 200;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DependencyEdgeData {
  [key: string]: unknown;
  /** Pre-computed SVG path string from A* routing. */
  path?: string;
  /** Lane offset for backward edges using the overhead lane. */
  laneOffset?: number;
}

// ── SVG path rendering ─────────────────────────────────────────────────────────

/**
 * Builds an SVG path from a list of orthogonal waypoints, rounding each
 * 90-degree corner with a quadratic Bézier curve capped at CORNER_RADIUS.
 */
export function buildRoundedPath(waypoints: Point[]): string {
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

    const dPrev = Math.max(Math.abs(curr.x - prev.x), Math.abs(curr.y - prev.y));
    const dNext = Math.max(Math.abs(next.x - curr.x), Math.abs(next.y - curr.y));
    const r = Math.min(CORNER_RADIUS, dPrev / 2, dNext / 2);

    const beforeX = curr.x + (r / dPrev) * (prev.x - curr.x);
    const beforeY = curr.y + (r / dPrev) * (prev.y - curr.y);

    const afterX = curr.x + (r / dNext) * (next.x - curr.x);
    const afterY = curr.y + (r / dNext) * (next.y - curr.y);

    parts.push(`L ${beforeX} ${beforeY}`);
    parts.push(`Q ${curr.x} ${curr.y} ${afterX} ${afterY}`);
  }

  const last = waypoints[waypoints.length - 1];
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(" ");
}

// ── Backward (right-to-left) edge routing ──────────────────────────────────────

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

// ── Simple edge routing (drag fast path) ───────────────────────────────────────

/**
 * Fast-path used during drag — simple elbow at destination Y, no lane offset.
 */
export function routeEdgeSimple(source: Point, destination: Point): string {
  if (source.x === destination.x && source.y === destination.y) {
    return "";
  }
  if (source.x < destination.x) {
    const pivotX = source.x + EXIT_STUB_PX;
    const waypoints: Point[] = [source];
    const push = (p: Point) => {
      const last = waypoints[waypoints.length - 1];
      if (last.x !== p.x || last.y !== p.y) {
        waypoints.push(p);
      }
    };
    push({ x: pivotX, y: source.y });
    push({ x: pivotX, y: destination.y });
    push(destination);
    return buildRoundedPath(waypoints);
  }
  return routeRightToLeftEdge(source, destination, 0);
}

function routeForwardEdge(
  edge: Edge,
  waypoints: Point[],
  nodePositions: Map<string, NodePosition>,
): Edge {
  let path = buildRoundedPath(waypoints);
  if (!path) {
    const sourcePosition = nodePositions.get(edge.source);
    const targetPosition = nodePositions.get(edge.target);
    if (sourcePosition && targetPosition) {
      path = routeEdgeSimple(
        {
          x: sourcePosition.x + sourcePosition.width,
          y: sourcePosition.y + sourcePosition.height / 2,
        },
        {
          x: targetPosition.x,
          y: targetPosition.y + targetPosition.height / 2,
        },
      );
    }
  }
  return { ...edge, data: { ...edge.data, path } };
}

// ── Main routing API ───────────────────────────────────────────────────────────

/**
 * Computes A*-routed paths for all forward (left-to-right) edges and simple
 * overhead paths for backward (right-to-left) edges. Returns edges with
 * pre-computed SVG path strings in `data.path`.
 */
export function assignLaneOffsets(
  edges: Edge[],
  nodePositions: Map<string, NodePosition>,
  parentMap: Map<string, string> = new Map(),
): Edge[] {
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

  // Compute bounds for waypoint graph
  const boundsMaxX =
    [...nodePositions.values()].reduce(
      (max, position) => Math.max(max, position.x + position.width),
      0,
    ) + ROUTING_RIGHT_PADDING;

  // Route forward edges using A* pathfinding
  const routeResults = routeAllEdges(forwardEdges, nodePositions, boundsMaxX, parentMap);

  const routedForwardEdges = routeResults.map((result) =>
    routeForwardEdge(result.edge, result.path, nodePositions),
  );

  // Route backward edges through overhead lane
  const routedBackwardEdges = backwardEdges.map((edge, index) => {
    const sourcePos = nodePositions.get(edge.source);
    const targetPos = nodePositions.get(edge.target);
    if (sourcePos === undefined || targetPos === undefined) {
      return { ...edge, data: { ...edge.data, path: "" } };
    }

    const sourceHandle: Point = {
      x: sourcePos.x + sourcePos.width,
      y: sourcePos.y + sourcePos.height / 2,
    };
    const targetHandle: Point = {
      x: targetPos.x,
      y: targetPos.y + targetPos.height / 2,
    };

    const numLanes = backwardEdges.length;
    const step = LANE_SPREAD_PX / Math.max(1, numLanes - 1);
    const laneOffset = (index - (numLanes - 1) / 2) * step;

    return {
      ...edge,
      data: {
        ...edge.data,
        path: routeRightToLeftEdge(sourceHandle, targetHandle, laneOffset),
        laneOffset,
      },
    };
  });

  return [...routedForwardEdges, ...routedBackwardEdges];
}
