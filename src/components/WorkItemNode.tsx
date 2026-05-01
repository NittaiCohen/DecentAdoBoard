import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { WorkItem } from "../types";

export interface WorkItemNodeData extends Record<string, unknown> {
  workItem: WorkItem;
  isParent: boolean;
  isExpanded: boolean;
  childCount: number;
  doneChildCount: number;
  onToggleExpand?: (id: number) => void;
}

export type WorkItemNode = Node<WorkItemNodeData, "workItem">;

const TYPE_COLORS: Record<string, string> = {
  Bug: "border-red-500 bg-red-100/50 dark:bg-red-950/50",
  Task: "border-yellow-500 bg-yellow-100/50 dark:bg-yellow-950/50",
  "User Story": "border-blue-500 bg-blue-100/50 dark:bg-blue-950/50",
  Feature: "border-purple-500 bg-purple-100/50 dark:bg-purple-950/50",
  Epic: "border-orange-500 bg-orange-100/50 dark:bg-orange-950/50",
  "Product Backlog Item": "border-blue-500 bg-blue-100/50 dark:bg-blue-950/50",
};

const STATE_BADGES: Record<string, string> = {
  New: "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200",
  Active: "bg-blue-600 text-blue-100",
  "In Progress": "bg-blue-600 text-blue-100",
  Resolved: "bg-green-700 text-green-100",
  Closed: "bg-green-800 text-green-100",
  Done: "bg-green-800 text-green-100",
  Removed: "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
};

function WorkItemNodeComponent({ data }: NodeProps<WorkItemNode>) {
  const { workItem, isParent, isExpanded, childCount, doneChildCount, onToggleExpand } = data;
  const colorClass =
    TYPE_COLORS[workItem.work_item_type] ?? "border-gray-500 bg-gray-100/50 dark:bg-gray-900/50";
  const stateClass =
    STATE_BADGES[workItem.state] ?? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200";

  return (
    <div
      className={`rounded-lg border-l-4 px-3 py-2 min-w-[180px] max-w-[220px] shadow-md ${colorClass}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-500 dark:!bg-gray-400 !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-500 dark:!bg-gray-400 !w-2 !h-2"
      />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{`#${workItem.id}`}</span>
        <span className={`text-[10px] px-1 py-0.5 rounded ${stateClass}`}>{workItem.state}</span>
        {isParent && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.(workItem.id);
            }}
            className="ml-auto text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "▼" : "▶"} {`${doneChildCount}/${childCount}`}
          </button>
        )}
      </div>

      <p
        className="text-xs text-gray-900 dark:text-gray-100 leading-tight line-clamp-2"
        title={workItem.title}
      >
        {workItem.title}
      </p>

      {workItem.assigned_to && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 truncate">
          {workItem.assigned_to}
        </p>
      )}
    </div>
  );
}

export default memo(WorkItemNodeComponent);
