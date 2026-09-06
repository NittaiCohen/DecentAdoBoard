import { useNodes, useStore } from "@xyflow/react";
import { buildNodePositions } from "../utils/graphLayout";
import { buildObstacles } from "../utils/pathfinding";

const OVERLAY_Z_INDEX = 1;
const OBSTACLE_FILL = "rgba(255, 0, 0, 0.1)";
const OBSTACLE_STROKE = "rgba(255, 0, 0, 0.4)";
const OBSTACLE_STROKE_WIDTH = 1;
const OBSTACLE_DASH_LENGTH = 4;
const LABEL_FONT_SIZE = 10;
const LABEL_FILL = "rgba(255, 0, 0, 0.7)";

/**
 * Debug overlay that draws obstacle rectangles on the graph.
 * Renders in the ReactFlow viewport coordinate system so rectangles
 * zoom and pan with the graph.
 *
 * Toggle via DEBUG_SHOW_OBSTACLES in edgeRouting.ts.
 */
export default function DebugObstacles() {
  const nodes = useNodes();
  const transform = useStore((state) => state.transform);
  const [transformX, transformY, zoom] = transform;

  const { positions: nodePositions } = buildNodePositions(nodes);
  const obstacles = buildObstacles(nodePositions, new Set());

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: OVERLAY_Z_INDEX,
      }}
    >
      <g transform={`translate(${transformX}, ${transformY}) scale(${zoom})`}>
        {obstacles.map((obstacle) => (
          <g key={obstacle.id}>
            <rect
              x={obstacle.left}
              y={obstacle.top}
              width={obstacle.right - obstacle.left}
              height={obstacle.bottom - obstacle.top}
              fill={OBSTACLE_FILL}
              stroke={OBSTACLE_STROKE}
              strokeWidth={OBSTACLE_STROKE_WIDTH / zoom}
              strokeDasharray={`${OBSTACLE_DASH_LENGTH / zoom}`}
            />
            <text
              x={(obstacle.left + obstacle.right) / 2}
              y={(obstacle.top + obstacle.bottom) / 2}
              fontSize={LABEL_FONT_SIZE / zoom}
              fill={LABEL_FILL}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {obstacle.id}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
