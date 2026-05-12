import { BaseEdge, useNodes } from "@xyflow/react";
import type { Edge, EdgeProps } from "@xyflow/react";
import type { Point } from "../types";
import { routeEdge, routeEdgeSimple } from "../utils/edgeRouting";
import type { DependencyEdgeData } from "../utils/edgeRouting";

type DependencyEdge = Edge<DependencyEdgeData, "dependency">;

function DependencyEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
}: EdgeProps<DependencyEdge>) {
  const nodes = useNodes();
  const isDraggingSourceOrTarget = nodes.some(
    (n) => n.dragging && (n.id === source || n.id === target),
  );

  // ReactFlow may render edges before nodes are measured — handle coords are NaN
  if (isNaN(sourceX) || isNaN(sourceY) || isNaN(targetX) || isNaN(targetY)) {
    return null;
  }

  const sourcePoint: Point = { x: sourceX, y: sourceY };
  const destinationPoint: Point = { x: targetX, y: targetY };

  const path = isDraggingSourceOrTarget
    ? routeEdgeSimple(sourcePoint, destinationPoint)
    : routeEdge(
        sourcePoint,
        destinationPoint,
        data?.routingStrategy ?? "elbow-destY",
        data?.laneOffset ?? 0,
      );

  return (
    <BaseEdge path={path} markerEnd={markerEnd} style={{ strokeWidth: 1.8, stroke: "#000" }} />
  );
}

export default DependencyEdge;
