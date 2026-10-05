import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { Reminder, WorkItem } from "../types";
import { TYPE_COLORS, DEFAULT_TYPE_COLOR } from "../utils/workItemColors";
import AssignedToDisplay from "./AssignedToDisplay";
import StateDropdown from "./StateDropdown";
import WorkItemTitleButton from "./WorkItemTitleButton";
import WorkItemTypeIcon from "./WorkItemTypeIcon";
import ReminderButton from "./ReminderButton";
import type { BOARD_NODE_TYPES } from "../types/graph";
import { listReminders } from "../api/tauri";
import { Plus } from "lucide-react";

export interface WorkItemNodeData extends Record<string, unknown> {
  workItem: WorkItem;
  isParent: boolean;
  isExpanded: boolean;
  isActionable: boolean;
  childCount: number;
  doneChildCount: number;
  hasTriggeredReminder?: boolean;
  onToggleExpand?: (id: number) => void;
  previewMode?: boolean;
  onPreviewStateChange?: (workItemId: number, newState: string) => void;
  onOpenOverview?: (id: number) => void;
  onCreateChild?: (parentWorkItem: WorkItem) => void;
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
      <WorkItemTypeIcon workItemType={workItem.type} className="h-3.5 w-3.5 shrink-0" />
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
  const { workItem, isActionable, onOpenOverview, onCreateChild, previewMode } = data;
  const { data: reminderData } = useQuery<Reminder[]>({
    queryKey: ["reminders"],
    queryFn: () => listReminders(),
    refetchInterval: 15_000,
  });
  const hasTriggeredReminder = (reminderData ?? []).some(
    (reminder) => reminder.work_item_id === workItem.id && reminder.status === "triggered",
  );
  const colorClass = TYPE_COLORS[workItem.type] ?? DEFAULT_TYPE_COLOR;
  const actionableRing = isActionable ? "ring-2 ring-green-500 dark:ring-green-400" : "";
  const triggeredReminderRing = hasTriggeredReminder
    ? "ring-2 ring-purple-500 outline outline-2 outline-purple-500 outline-offset-1 dark:ring-purple-400 dark:outline-purple-400"
    : "";

  return (
    <div
      className={`flex min-h-[80px] min-w-[180px] max-w-[220px] flex-col overflow-hidden rounded-lg border-l-4 px-3 py-2 shadow-md ${colorClass} ${actionableRing} ${triggeredReminderRing}`}
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

      <div className="flex shrink-0 items-center justify-between gap-2">
        <AssignedToDisplay value={workItem.assigned_to} />
        <div className="flex items-center gap-1">
          {!previewMode && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateChild?.(workItem);
              }}
              className="nodrag nopan rounded p-1 text-gray-500 hover:bg-black/10 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
              title="Create child work item"
              aria-label={`Create child work item for ${workItem.title}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          <ReminderButton
            workItemId={workItem.id}
            workItemTitle={workItem.title}
            isTriggered={hasTriggeredReminder}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(WorkItemNodeComponent);
