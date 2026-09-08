import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { WorkItem } from "../types";
import { TYPE_COLORS, DEFAULT_TYPE_COLOR } from "../utils/workItemColors";
import AssignedToDisplay from "./AssignedToDisplay";
import StateDropdown from "./StateDropdown";
import WorkItemTitleButton from "./WorkItemTitleButton";
import type { BOARD_NODE_TYPES } from "../types/graph";

export interface WorkItemNodeData extends Record<string, unknown> {
  workItem: WorkItem;
  isParent: boolean;
  isExpanded: boolean;
  isActionable: boolean;
  childCount: number;
  doneChildCount: number;
  onToggleExpand?: (id: number) => void;
  previewMode?: boolean;
  onPreviewStateChange?: (workItemId: number, newState: string) => void;
  onOpenOverview?: (id: number) => void;
}

export type WorkItemNode = Node<WorkItemNodeData, typeof BOARD_NODE_TYPES.workItem>;

function WorkItemHeader({ data }: { data: WorkItemNodeData }) {
  const {
    workItem,
    isParent,
    isExpanded,
    childCount,
    doneChildCount,
    onToggleExpand,
    previewMode,
    onPreviewStateChange,
  } = data;

  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
        {previewMode ? "Preview" : `#${workItem.id}`}
      </span>
      <StateDropdown
        workItemId={workItem.id}
        workItemType={workItem.type}
        currentState={workItem.state}
        onStateChange={
          onPreviewStateChange
            ? (newState) => onPreviewStateChange(workItem.id, newState)
            : undefined
        }
      />
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
  );
}

function WorkItemNodeComponent({ data }: NodeProps<WorkItemNode>) {
  const { workItem, isActionable, onOpenOverview } = data;
  const colorClass = TYPE_COLORS[workItem.type] ?? DEFAULT_TYPE_COLOR;
  const actionableRing = isActionable ? "ring-2 ring-green-500 dark:ring-green-400" : "";

  return (
    <div
      className={`flex min-h-[80px] min-w-[180px] max-w-[220px] flex-col overflow-hidden rounded-lg border-l-4 px-3 py-2 shadow-md ${colorClass} ${actionableRing}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable
        className="!bg-gray-500 dark:!bg-gray-400 !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable
        className="!bg-gray-500 dark:!bg-gray-400 !w-2 !h-2"
      />

      <div className="shrink-0">
        <WorkItemHeader data={data} />
      </div>

      <WorkItemTitleButton
        onOpen={() => onOpenOverview?.(workItem.id)}
        title={workItem.title}
        className="min-h-0 flex-1 overflow-hidden text-left text-xs leading-tight text-gray-900 hover:underline dark:text-gray-100 line-clamp-10"
      >
        {workItem.title}
      </WorkItemTitleButton>

      <div className="shrink-0">
        <AssignedToDisplay value={workItem.assigned_to} />
      </div>
    </div>
  );
}

export default memo(WorkItemNodeComponent);
