import type { Edge, EdgeProps } from "@xyflow/react";
import { BaseEdge, useNodes } from "@xyflow/react";
import type { DependencyEdgeData } from "../utils/edgeRouting";
import { routeEdgeSimple } from "../utils/edgeRouting";

type DependencyEdge = Edge<DependencyEdgeData, "dependency">;

const EDGE_STROKE_WIDTH = 1.8;
const EDGE_SELECTED_STROKE_WIDTH = 2.8;
const EDGE_INTERACTION_WIDTH = 20;

function DependencyEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  selected,
}: EdgeProps<DependencyEdge>) {
  const nodes = useNodes();
  const isDraggingSourceOrTarget = nodes.some(
    (n) => n.dragging && (n.id === source || n.id === target),
  );

  // ReactFlow may render edges before nodes are measured — handle coords are NaN
  if (isNaN(sourceX) || isNaN(sourceY) || isNaN(targetX) || isNaN(targetY)) {
    return null;
  }

  const path = isDraggingSourceOrTarget
    ? routeEdgeSimple({ x: sourceX, y: sourceY }, { x: targetX, y: targetY })
    : (data?.path ?? "");

  const stroke = selected ? "#2563eb" : "#000";
  const strokeWidth = selected ? EDGE_SELECTED_STROKE_WIDTH : EDGE_STROKE_WIDTH;

  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      interactionWidth={EDGE_INTERACTION_WIDTH}
      style={{ strokeWidth, stroke }}
    />
  );
}

export default DependencyEdge;
