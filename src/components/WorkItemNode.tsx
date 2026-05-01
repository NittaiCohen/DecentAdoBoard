import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { WorkItem } from "../types";
import {
  TYPE_COLORS,
  DEFAULT_TYPE_COLOR,
  STATE_BADGES,
  DEFAULT_STATE_BADGE,
} from "../utils/workItemColors";

export interface WorkItemNodeData extends Record<string, unknown> {
  workItem: WorkItem;
  isParent: boolean;
  isExpanded: boolean;
  isActionable: boolean;
  childCount: number;
  doneChildCount: number;
  onToggleExpand?: (id: number) => void;
}

export type WorkItemNode = Node<WorkItemNodeData, "workItem">;

function WorkItemNodeComponent({ data }: NodeProps<WorkItemNode>) {
  const {
    workItem,
    isParent,
    isExpanded,
    isActionable,
    childCount,
    doneChildCount,
    onToggleExpand,
  } = data;
  const colorClass = TYPE_COLORS[workItem.work_item_type] ?? DEFAULT_TYPE_COLOR;
  const stateClass = STATE_BADGES[workItem.state] ?? DEFAULT_STATE_BADGE;
  const actionableRing = isActionable ? "ring-2 ring-green-500 dark:ring-green-400" : "";

  return (
    <div
      className={`rounded-lg border-l-4 px-3 py-2 min-w-[180px] max-w-[220px] shadow-md ${colorClass} ${actionableRing}`}
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
