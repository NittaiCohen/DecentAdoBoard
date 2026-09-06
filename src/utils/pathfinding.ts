import type { Edge } from "@xyflow/react";
import type { Point } from "../types";
import type { NodePosition } from "./graphLayout";

// Inline constant to avoid circular dependency (pathfinding → graphLayout → edgeRouting → pathfinding).
// Value must match graphLayout.ts: NODE_GAP_X = 60.
// TODO See if the value can be moved to a fitting new or existing file to avoid having to create it twice in two different places.
const NODE_GAP_X = 60;

// ── Constants ──────────────────────────────────────────────────────────────────

/** Padding (px) around each work item node to create obstacle rectangles. */
export const OBSTACLE_PADDING = 8;

/** Cost penalty (px equivalent) added for each 90-degree turn in A*. */
export const TURN_PENALTY = 35;

/** Distance (px) the target handle sits left of the work item's left edge. */
export const HANDLE_OFFSET = 8;

/**
 * Small per-pixel cost added when continuing straight while the target is
 * offset on the perpendicular axis. Encourages earlier turns.
 */
const EARLY_TURN_BIAS = 0.2;

/** Minimum horizontal distance (px) from the source before the first vertical. */
const MIN_HORIZONTAL_FROM_SOURCE = NODE_GAP_X / 2; // 30px

/** Step size (px) for scanning unblocked vertical corridors in post-processing. */
const SHIFT_STEP = 4;

/** Total perpendicular spread (px) when separating overlapping segments. */
export const OVERLAP_TOTAL_SPREAD = 30;

/** Margin (px) beyond the outermost obstacles for the waypoint search area. */
const WAYPOINT_BOUNDS_MARGIN = 60;

/** Default maximum Y extent (px) for the waypoint search area. */
const WAYPOINT_BOUNDS_MAX_Y = 2000;

/** Small inset (px) used to avoid treating points exactly on obstacle edges as inside. */
const OBSTACLE_EDGE_EPSILON = 0.5;

/** Number of points in a single-turn path. */
const THREE_POINT_PATH_LENGTH = 3;

/** Small offset below which segment movement is not needed. */
const MIN_SEGMENT_OFFSET = 0.5;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Obstacle {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WaypointGraph {
  waypoints: Point[];
  edges: Array<{ from: number; to: number }>;
}

export interface PathResult {
  path: Point[];
  cost: number;
  turns: number;
}

export interface RouteResult {
  edge: Edge;
  path: Point[];
  sourceId: string;
  targetId: string;
}

// ── Direction enum for A* state ────────────────────────────────────────────────

const DIRECTION_NONE = 0;
const DIRECTION_HORIZONTAL = 1;
const DIRECTION_VERTICAL = 2;

// ── Obstacle building ──────────────────────────────────────────────────────────

/**
 * Converts node positions to padded obstacle rectangles, excluding source and
 * target nodes (which the arrow connects to).
 */
export function buildObstacles(
  nodePositions: Map<string, NodePosition>,
  excludeIds: Set<string>,
): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const [id, position] of nodePositions) {
    if (excludeIds.has(id)) {
      continue;
    }
    // Only work item and group nodes are obstacles — skip dividers, ghosts, etc.
    if (!id.startsWith("wi-") && !id.startsWith("group-")) {
      continue;
    }
    obstacles.push({
      id,
      left: position.x - OBSTACLE_PADDING,
      top: position.y - OBSTACLE_PADDING,
      right: position.x + position.width + OBSTACLE_PADDING,
      bottom: position.y + position.height + OBSTACLE_PADDING,
    });
  }
  return obstacles;
}

// ── Segment-obstacle intersection ──────────────────────────────────────────────

/**
 * Returns true if an axis-aligned segment from (x1,y1) to (x2,y2) passes
 * through any obstacle rectangle.
 */
export function segmentBlockedByObstacles(from: Point, to: Point, obstacles: Obstacle[]): boolean {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  for (const obstacle of obstacles) {
    if (from.y === to.y) {
      // Horizontal segment
      if (
        minY > obstacle.top &&
        minY < obstacle.bottom &&
        minX < obstacle.right &&
        maxX > obstacle.left
      ) {
        return true;
      }
    } else if (from.x === to.x) {
      // Vertical segment
      if (
        minX > obstacle.left &&
        minX < obstacle.right &&
        minY < obstacle.bottom &&
        maxY > obstacle.top
      ) {
        return true;
      }
    }
  }
  return false;
}

// ── Waypoint graph construction ────────────────────────────────────────────────

/**
 * Builds a sparse waypoint graph from obstacle corners and source/target
 * projections. Only axis-aligned, unblocked connections are included.
 */
// eslint-disable-next-line max-lines-per-function
export function buildWaypointGraph(
  obstacles: Obstacle[],
  source: Point,
  target: Point,
  boundsMaxX: number,
): WaypointGraph {
  const candidateWaypoints: Point[] = [source, target];
  const boundsMinX = -WAYPOINT_BOUNDS_MARGIN;
  const boundsMinY = -WAYPOINT_BOUNDS_MARGIN;
  const boundsMaxY = WAYPOINT_BOUNDS_MAX_Y;

  // Add obstacle corner waypoints
  for (const obstacle of obstacles) {
    const corners: Point[] = [
      { x: obstacle.left, y: obstacle.top },
      { x: obstacle.right, y: obstacle.top },
      { x: obstacle.left, y: obstacle.bottom },
      { x: obstacle.right, y: obstacle.bottom },
    ];
    for (const corner of corners) {
      let insideOther = false;
      for (const other of obstacles) {
        if (other === obstacle) {
          continue;
        }
        if (
          corner.x > other.left &&
          corner.x < other.right &&
          corner.y > other.top &&
          corner.y < other.bottom
        ) {
          insideOther = true;
          break;
        }
      }
      if (
        !insideOther &&
        corner.x >= boundsMinX &&
        corner.x <= boundsMaxX &&
        corner.y >= boundsMinY &&
        corner.y <= boundsMaxY
      ) {
        candidateWaypoints.push(corner);
      }
    }
  }

  // Add source/target projections onto obstacle edges
  for (const obstacle of obstacles) {
    for (const point of [source, target]) {
      if (point.y > obstacle.top && point.y < obstacle.bottom) {
        candidateWaypoints.push({ x: obstacle.left, y: point.y });
        candidateWaypoints.push({ x: obstacle.right, y: point.y });
      }
      if (point.x > obstacle.left && point.x < obstacle.right) {
        candidateWaypoints.push({ x: point.x, y: obstacle.top });
        candidateWaypoints.push({ x: point.x, y: obstacle.bottom });
      }
    }
  }

  // Add cross-projections so A* can route between different Y levels
  // even when there are no obstacles creating intermediate waypoints.
  if (source.y !== target.y) {
    const midX = (source.x + target.x) / 2;
    candidateWaypoints.push({ x: midX, y: source.y });
    candidateWaypoints.push({ x: midX, y: target.y });
    candidateWaypoints.push({ x: source.x, y: target.y });
    candidateWaypoints.push({ x: target.x, y: source.y });
  }

  // Deduplicate and filter points inside obstacles
  const uniqueWaypoints: Point[] = [];
  const seen = new Set<string>();
  for (const waypoint of candidateWaypoints) {
    const key = `${Math.round(waypoint.x)},${Math.round(waypoint.y)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    let inside = false;
    for (const obstacle of obstacles) {
      if (
        waypoint.x > obstacle.left + OBSTACLE_EDGE_EPSILON &&
        waypoint.x < obstacle.right - OBSTACLE_EDGE_EPSILON &&
        waypoint.y > obstacle.top + OBSTACLE_EDGE_EPSILON &&
        waypoint.y < obstacle.bottom - OBSTACLE_EDGE_EPSILON
      ) {
        inside = true;
        break;
      }
    }
    if (!inside) {
      uniqueWaypoints.push(waypoint);
    }
  }

  // Build visibility edges (axis-aligned, unblocked)
  const graphEdges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < uniqueWaypoints.length; i++) {
    for (let j = i + 1; j < uniqueWaypoints.length; j++) {
      const a = uniqueWaypoints[i];
      const b = uniqueWaypoints[j];
      if (a.x !== b.x && a.y !== b.y) {
        continue;
      }
      if (!segmentBlockedByObstacles(a, b, obstacles)) {
        graphEdges.push({ from: i, to: j });
      }
    }
  }

  return { waypoints: uniqueWaypoints, edges: graphEdges };
}

// ── A* pathfinding ─────────────────────────────────────────────────────────────

interface AStarState {
  waypointIndex: number;
  direction: number;
  fScore: number;
  gScore: number;
}

/**
 * Finds the shortest orthogonal path through the waypoint graph using A*
 * with direction-aware state. Turn penalties and misalignment costs encourage
 * paths with fewer turns that turn early.
 *
 * State: (waypointIndex, direction) where direction ∈ {0=none, 1=horizontal, 2=vertical}.
 * Start direction is forced to horizontal (1) so the first move is always rightward.
 * From the source, only rightward neighbors are considered.
 */
// eslint-disable-next-line max-lines-per-function
export function orthogonalAStar(
  graph: WaypointGraph,
  sourceIndex: number,
  targetIndex: number,
  turnPenalty: number,
): PathResult {
  const { waypoints, edges: graphEdges } = graph;

  // Build adjacency list
  const adjacency = new Map<number, number[]>();
  for (const edge of graphEdges) {
    let fromNeighbors = adjacency.get(edge.from);
    if (fromNeighbors === undefined) {
      fromNeighbors = [];
      adjacency.set(edge.from, fromNeighbors);
    }
    fromNeighbors.push(edge.to);

    let toNeighbors = adjacency.get(edge.to);
    if (toNeighbors === undefined) {
      toNeighbors = [];
      adjacency.set(edge.to, toNeighbors);
    }
    toNeighbors.push(edge.from);
  }

  const target = waypoints[targetIndex];
  const openSet: AStarState[] = [];
  const gScoreMap = new Map<string, number>();
  const cameFrom = new Map<string, string>();

  const startKey = `${sourceIndex},${DIRECTION_HORIZONTAL}`;
  gScoreMap.set(startKey, 0);
  const initialHeuristic =
    Math.abs(waypoints[sourceIndex].x - target.x) + Math.abs(waypoints[sourceIndex].y - target.y);
  openSet.push({
    waypointIndex: sourceIndex,
    direction: DIRECTION_HORIZONTAL,
    fScore: initialHeuristic,
    gScore: 0,
  });

  while (openSet.length > 0) {
    // Find state with lowest f-score
    let bestIndex = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].fScore < openSet[bestIndex].fScore) {
        bestIndex = i;
      }
    }
    const current = openSet.splice(bestIndex, 1)[0];
    const currentKey = `${current.waypointIndex},${current.direction}`;

    // Reached the target
    if (current.waypointIndex === targetIndex) {
      const pathIndices = [targetIndex];
      let key = currentKey;
      while (cameFrom.has(key)) {
        const parentKey = cameFrom.get(key);
        if (parentKey === undefined) {
          break;
        }
        pathIndices.unshift(parseInt(parentKey.split(",")[0]));
        key = parentKey;
      }
      return {
        path: pathIndices.map((i) => waypoints[i]),
        cost: current.gScore,
        turns: countTurns(pathIndices, waypoints),
      };
    }

    const neighbors = adjacency.get(current.waypointIndex) ?? [];
    const currentWaypoint = waypoints[current.waypointIndex];

    for (const neighborIndex of neighbors) {
      const neighbor = waypoints[neighborIndex];

      // From source, only allow rightward moves
      if (current.waypointIndex === sourceIndex && neighbor.x <= currentWaypoint.x) {
        continue;
      }

      const distance =
        Math.abs(neighbor.x - currentWaypoint.x) + Math.abs(neighbor.y - currentWaypoint.y);
      const newDirection =
        neighbor.x === currentWaypoint.x ? DIRECTION_VERTICAL : DIRECTION_HORIZONTAL;
      const isTurn = current.direction !== DIRECTION_NONE && newDirection !== current.direction;

      // Misalignment cost: continuing straight when target is offset perpendicular
      const dx = Math.abs(neighbor.x - target.x);
      const dy = Math.abs(neighbor.y - target.y);
      const misalignmentCost =
        !isTurn && newDirection === DIRECTION_HORIZONTAL && dy > 0
          ? EARLY_TURN_BIAS * distance
          : !isTurn && newDirection === DIRECTION_VERTICAL && dx > 0
            ? EARLY_TURN_BIAS * distance
            : 0;

      const tentativeGScore =
        current.gScore + distance + (isTurn ? turnPenalty : 0) + misalignmentCost;
      const neighborKey = `${neighborIndex},${newDirection}`;
      const existingGScore = gScoreMap.get(neighborKey);

      if (existingGScore === undefined || tentativeGScore < existingGScore) {
        gScoreMap.set(neighborKey, tentativeGScore);
        cameFrom.set(neighborKey, currentKey);
        openSet.push({
          waypointIndex: neighborIndex,
          direction: newDirection,
          fScore: tentativeGScore + dx + dy,
          gScore: tentativeGScore,
        });
      }
    }
  }

  return { path: [], cost: Infinity, turns: 0 };
}

function countTurns(pathIndices: number[], waypoints: Point[]): number {
  let turns = 0;
  for (let i = 2; i < pathIndices.length; i++) {
    const a = waypoints[pathIndices[i - 2]];
    const b = waypoints[pathIndices[i - 1]];
    const c = waypoints[pathIndices[i]];
    const previousDirection = b.x === a.x ? "v" : "h";
    const currentDirection = c.x === b.x ? "v" : "h";
    if (previousDirection !== currentDirection) {
      turns++;
    }
  }
  return turns;
}

// ── Post-processing: shift verticals left ──────────────────────────────────────

/**
 * Pushes each vertical segment as far left as possible so turns happen
 * earlier rather than at the last moment. Enforces a minimum horizontal
 * distance from the source.
 */
// eslint-disable-next-line max-lines-per-function
export function shiftVerticalsLeft(path: Point[], obstacles: Obstacle[]): Point[] {
  if (path.length < THREE_POINT_PATH_LENGTH) {
    return path;
  }

  // Remove collinear middle points so every interior point is a turn
  const points: Point[] = [{ x: path[0].x, y: path[0].y }];
  for (let i = 1; i < path.length - 1; i++) {
    const previous = points[points.length - 1];
    const current = path[i];
    const next = path[i + 1];
    const collinearX = previous.x === current.x && current.x === next.x;
    const collinearY = previous.y === current.y && current.y === next.y;
    if (collinearX || collinearY) {
      continue;
    }
    points.push({ x: current.x, y: current.y });
  }
  points.push({ x: path[path.length - 1].x, y: path[path.length - 1].y });

  // 3-point single turn: convert L to Z, pushing the vertical left
  if (points.length === THREE_POINT_PATH_LENGTH) {
    const [a, , c] = points;
    const isHorizontalThenVertical = a.y === points[1].y;
    if (isHorizontalThenVertical) {
      const minimumX = a.x + MIN_HORIZONTAL_FROM_SOURCE;
      for (let x = minimumX; x <= c.x; x += SHIFT_STEP) {
        if (
          !segmentBlockedByObstacles(a, { x, y: a.y }, obstacles) &&
          !segmentBlockedByObstacles({ x, y: a.y }, { x, y: c.y }, obstacles) &&
          !segmentBlockedByObstacles({ x, y: c.y }, c, obstacles)
        ) {
          return [a, { x, y: a.y }, { x, y: c.y }, c];
        }
      }
    }
    return points;
  }

  // 4+ point paths: shift each interior vertical segment leftward
  for (let i = 1; i < points.length - 2; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const d = points[i + 2];
    const segment0Horizontal = a.y === b.y;
    const segment1Horizontal = b.y === c.y;
    const segment2Horizontal = c.y === d.y;

    // Must be a turn pair: direction changes at both B and C
    if (segment0Horizontal === segment1Horizontal || segment1Horizontal === segment2Horizontal) {
      continue;
    }

    if (!segment1Horizontal) {
      // Middle segment B→C is vertical — shift X leftward
      const isFirstVertical = i === 1;
      const leftBound = isFirstVertical
        ? points[0].x + MIN_HORIZONTAL_FROM_SOURCE
        : Math.min(a.x, d.x) + SHIFT_STEP;
      for (let x = leftBound; x < b.x; x += SHIFT_STEP) {
        if (
          !segmentBlockedByObstacles(a, { x, y: a.y }, obstacles) &&
          !segmentBlockedByObstacles({ x, y: b.y }, { x, y: c.y }, obstacles) &&
          !segmentBlockedByObstacles({ x, y: d.y }, d, obstacles)
        ) {
          points[i] = { x, y: b.y };
          points[i + 1] = { x, y: c.y };
          break;
        }
      }
    }
  }

  // Handle terminal vertical: last two points form a vertical segment
  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];
  if (
    points.length >= THREE_POINT_PATH_LENGTH &&
    secondLast.x === last.x &&
    secondLast.y !== last.y
  ) {
    const beforeSecondLast = points[points.length - THREE_POINT_PATH_LENGTH];
    if (beforeSecondLast.y === secondLast.y) {
      const leftBound = beforeSecondLast.x + SHIFT_STEP;
      for (let x = leftBound; x < secondLast.x; x += SHIFT_STEP) {
        if (
          !segmentBlockedByObstacles(beforeSecondLast, { x, y: beforeSecondLast.y }, obstacles) &&
          !segmentBlockedByObstacles({ x, y: secondLast.y }, { x, y: last.y }, obstacles) &&
          !segmentBlockedByObstacles({ x, y: last.y }, last, obstacles)
        ) {
          points[points.length - 2] = { x, y: secondLast.y };
          points.splice(points.length - 1, 0, { x, y: last.y });
          break;
        }
      }
    }
  }

  return points;
}

// ── Post-processing: finalize path endpoint ────────────────────────────────────

/**
 * Connects the path to the actual work item edge by extending or appending
 * a horizontal segment of HANDLE_OFFSET pixels.
 */
function finalizePath(path: Point[]): Point[] {
  if (path.length < 2) {
    return path;
  }
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (secondLast.y === last.y) {
    // Last segment is horizontal — extend it by HANDLE_OFFSET
    path[path.length - 1] = { x: last.x + HANDLE_OFFSET, y: last.y };
  } else {
    // Last segment is vertical — append a short horizontal segment
    path.push({ x: last.x + HANDLE_OFFSET, y: last.y });
  }
  return path;
}

// ── Post-processing: separate overlapping segments ─────────────────────────────

interface SegmentInfo {
  routeIndex: number;
  segmentIndex: number;
  sourceId: string;
  targetId: string;
  isFirst: boolean;
  isLast: boolean;
  direction: "H" | "V";
  fixedCoord: number;
  rangeMin: number;
  rangeMax: number;
  pointIndexA: number;
  pointIndexB: number;
}

/**
 * Detects overlapping segments between routes with different source AND
 * target, then shifts interior segments apart. First and last segments
 * are never moved.
 */
// eslint-disable-next-line max-lines-per-function
export function separateOverlappingSegments(routes: RouteResult[]): void {
  // Extract all segments
  const segments: SegmentInfo[] = [];
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex];
    const path = route.path;
    if (path.length < 2) {
      continue;
    }
    for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex++) {
      const a = path[segmentIndex];
      const b = path[segmentIndex + 1];
      const isFirst = segmentIndex === 0;
      const isLast = segmentIndex === path.length - 2;
      const isHorizontal = a.y === b.y;
      const isVertical = a.x === b.x;
      if (!isHorizontal && !isVertical) {
        continue;
      }
      segments.push({
        routeIndex,
        segmentIndex,
        sourceId: route.sourceId,
        targetId: route.targetId,
        isFirst,
        isLast,
        direction: isHorizontal ? "H" : "V",
        fixedCoord: isHorizontal ? a.y : a.x,
        rangeMin: isHorizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        rangeMax: isHorizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
        pointIndexA: segmentIndex,
        pointIndexB: segmentIndex + 1,
      });
    }
  }

  // Group by direction + fixedCoord
  const groups = new Map<string, SegmentInfo[]>();
  for (const segment of segments) {
    const key = `${segment.direction}:${segment.fixedCoord}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = [];
      groups.set(key, group);
    }
    group.push(segment);
  }

  // Find overlapping clusters and separate them
  for (const [, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    group.sort((a, b) => a.rangeMin - b.rangeMin);

    for (let i = 0; i < group.length; i++) {
      const cluster = [group[i]];
      let clusterMax = group[i].rangeMax;
      for (let j = i + 1; j < group.length; j++) {
        if (group[j].rangeMin < clusterMax) {
          cluster.push(group[j]);
          clusterMax = Math.max(clusterMax, group[j].rangeMax);
        } else {
          break;
        }
      }
      if (cluster.length < 2) {
        continue;
      }
      i += cluster.length - 1;

      // Filter: only segments from edges with different source AND target
      const needsSeparation: SegmentInfo[] = [];
      for (let a = 0; a < cluster.length; a++) {
        let hasConflict = false;
        for (let b = 0; b < cluster.length; b++) {
          if (a === b) {
            continue;
          }
          if (
            cluster[a].sourceId !== cluster[b].sourceId &&
            cluster[a].targetId !== cluster[b].targetId
          ) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) {
          needsSeparation.push(cluster[a]);
        }
      }
      if (needsSeparation.length < 2) {
        continue;
      }

      const fixed = needsSeparation.filter((s) => s.isFirst || s.isLast);
      const movable = needsSeparation.filter((s) => !s.isFirst && !s.isLast);
      if (movable.length === 0) {
        continue;
      }

      const totalSegments = fixed.length + movable.length;
      const gap = OVERLAP_TOTAL_SPREAD / (totalSegments - 1);

      if (fixed.length > 0) {
        // Fixed segments stay; spread movable around them
        const offsets: number[] = [];
        for (let k = 0; k < totalSegments; k++) {
          offsets.push(-OVERLAP_TOTAL_SPREAD / 2 + k * gap);
        }
        const sortedOffsets = offsets.slice().sort((a, b) => Math.abs(a) - Math.abs(b));
        const movableOffsets = sortedOffsets.slice(fixed.length);
        for (let m = 0; m < movable.length; m++) {
          applySegmentOffset(routes, movable[m], movableOffsets[m]);
        }
      } else {
        // All movable: spread evenly around original position
        for (let m = 0; m < movable.length; m++) {
          const offset = -OVERLAP_TOTAL_SPREAD / 2 + m * gap;
          applySegmentOffset(routes, movable[m], offset);
        }
      }
    }
  }
}

function applySegmentOffset(routes: RouteResult[], segment: SegmentInfo, offset: number): void {
  if (Math.abs(offset) < MIN_SEGMENT_OFFSET) {
    return;
  }
  const path = routes[segment.routeIndex].path;
  const indexA = segment.pointIndexA;
  const indexB = segment.pointIndexB;

  if (segment.direction === "H") {
    path[indexA] = { x: path[indexA].x, y: path[indexA].y + offset };
    path[indexB] = { x: path[indexB].x, y: path[indexB].y + offset };
  } else {
    path[indexA] = { x: path[indexA].x + offset, y: path[indexA].y };
    path[indexB] = { x: path[indexB].x + offset, y: path[indexB].y };
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────────────

/**
 * Routes all forward (left-to-right) edges using A* pathfinding with
 * obstacle avoidance, then applies post-processing (shift verticals left,
 * finalize endpoints, separate overlapping segments).
 */
export function routeAllEdges(
  edges: Edge[],
  nodePositions: Map<string, NodePosition>,
  boundsMaxX: number,
  parentMap: Map<string, string> = new Map(),
): RouteResult[] {
  const routes: RouteResult[] = [];

  for (const edge of edges) {
    const sourcePosition = nodePositions.get(edge.source);
    const targetPosition = nodePositions.get(edge.target);
    if (sourcePosition === undefined || targetPosition === undefined) {
      routes.push({ edge, path: [], sourceId: edge.source, targetId: edge.target });
      continue;
    }

    const sourceHandle: Point = {
      x: sourcePosition.x + sourcePosition.width,
      y: sourcePosition.y + sourcePosition.height / 2,
    };
    const targetHandle: Point = {
      x: targetPosition.x - HANDLE_OFFSET,
      y: targetPosition.y + targetPosition.height / 2,
    };

    // Exclude source, target, and all of their ancestor groups from obstacles.
    const excludeIds = new Set([edge.source, edge.target]);
    const excludeAncestorGroups = (nodeId: string) => {
      let ancestorId = parentMap.get(nodeId);
      while (ancestorId !== undefined) {
        excludeIds.add(ancestorId);
        ancestorId = parentMap.get(ancestorId);
      }
    };
    excludeAncestorGroups(edge.source);
    excludeAncestorGroups(edge.target);
    const obstacles = buildObstacles(nodePositions, excludeIds);
    const graph = buildWaypointGraph(obstacles, sourceHandle, targetHandle, boundsMaxX);
    const result = orthogonalAStar(graph, 0, 1, TURN_PENALTY);

    let path = shiftVerticalsLeft(result.path, obstacles);

    path = finalizePath(path);

    routes.push({ edge, path, sourceId: edge.source, targetId: edge.target });
  }

  separateOverlappingSegments(routes);

  return routes;
}
