import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";

export interface SprintDividerData extends Record<string, unknown> {
  label: string;
  startDate: string | null;
  finishDate: string | null;
  height: number;
  width: number;
  isCurrent: boolean;
}

export type SprintDividerNode = Node<SprintDividerData, "sprintDivider">;

function SprintDividerComponent({ data }: NodeProps<SprintDividerNode>) {
  const bgClass = data.isCurrent
    ? "bg-blue-500/8 border border-blue-500/30"
    : "bg-gray-700/5 border border-gray-700/20";
  const labelClass = data.isCurrent
    ? "bg-blue-600/80 text-blue-100 font-semibold"
    : "bg-gray-700/50 text-gray-400";

  return (
    <div
      className={`flex flex-col items-center pointer-events-none rounded-lg ${bgClass}`}
      style={{ height: data.height, width: data.width }}
    >
      <div className={`${labelClass} text-[11px] px-3 py-1 rounded-b mb-1 whitespace-nowrap`}>
        {data.isCurrent ? `● ${data.label}` : data.label}
      </div>
    </div>
  );
}

export default memo(SprintDividerComponent);
