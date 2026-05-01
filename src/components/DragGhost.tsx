import { memo } from "react";
import type { NodeProps, Node } from "@xyflow/react";
import type { DragGhostData } from "../utils/graphLayout";

export type DragGhostNode = Node<DragGhostData, "dragGhost">;

function DragGhostComponent({ data }: NodeProps<DragGhostNode>) {
  return (
    <div
      className="rounded-lg border-2 border-dashed border-blue-400 dark:border-blue-500 bg-blue-100/30 dark:bg-blue-900/20"
      style={{ width: data.width, height: data.height }}
    />
  );
}

export default memo(DragGhostComponent);
