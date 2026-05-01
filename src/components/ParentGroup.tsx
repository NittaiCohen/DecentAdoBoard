import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export interface ParentGroupData extends Record<string, unknown> {
  label: string;
  workItemId: number;
  workItemType: string;
  state: string;
  childCount: number;
  doneChildCount: number;
  width: number;
  height: number;
  onToggleExpand?: (id: number) => void;
}

export type ParentGroupNode = Node<ParentGroupData, "parentGroup">;

const TYPE_BORDER: Record<string, string> = {
  Bug: "border-red-500",
  Task: "border-yellow-500",
  "User Story": "border-blue-500",
  Feature: "border-purple-500",
  Epic: "border-orange-500",
  "Product Backlog Item": "border-blue-500",
};

function ParentGroupComponent({ data }: NodeProps<ParentGroupNode>) {
  const borderClass = TYPE_BORDER[data.workItemType] ?? "border-gray-500";

  return (
    <div
      className={`rounded-lg border-l-4 ${borderClass} bg-gray-800/60 border border-gray-600/50`}
      style={{ width: data.width, height: data.height }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-600/50 bg-gray-700/40 rounded-t-lg">
        <span className="text-[10px] font-mono text-gray-400">#{data.workItemId}</span>
        <span className="text-[10px] px-1 py-0.5 rounded bg-gray-600 text-gray-200">
          {data.state}
        </span>
        <span className="text-xs text-gray-100 truncate flex-1">{data.label}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleExpand?.(data.workItemId);
          }}
          className="text-[10px] text-gray-400 hover:text-gray-200 flex-shrink-0"
          title="Collapse"
        >
          ▼ {data.doneChildCount}/{data.childCount}
        </button>
      </div>
    </div>
  );
}

export default memo(ParentGroupComponent);
