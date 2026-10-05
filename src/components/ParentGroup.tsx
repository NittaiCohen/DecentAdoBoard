import { memo } from "react";
import { Handle, Position, useStore, type NodeProps, type Node } from "@xyflow/react";

import StateDropdown from "./StateDropdown";
import WorkItemTitleButton from "./WorkItemTitleButton";
import WorkItemTypeIcon from "./WorkItemTypeIcon";
import { DEFAULT_PARENT_GROUP_TYPE_COLOR, PARENT_GROUP_TYPE_COLORS } from "../utils/workItemColors";
import type { BOARD_NODE_TYPES } from "../types/graph";
import { Plus } from "lucide-react";
import type { WorkItem } from "../types";

export interface ParentGroupData extends Record<string, unknown> {
  label: string;
  workItem: WorkItem;
  workItemId: number;
  workItemType: string;
  state: string;
  childCount: number;
  doneChildCount: number;
  width: number;
  height: number;
  onToggleExpand?: (id: number) => void;
  previewMode?: boolean;
  onPreviewStateChange?: (workItemId: number, newState: string) => void;
  onOpenOverview?: (id: number) => void;
  onCreateChild?: (parentWorkItem: WorkItem) => void;
}

export type ParentGroupNode = Node<ParentGroupData, typeof BOARD_NODE_TYPES.parentGroup>;

/** Minimum header width that must remain visible when offset is applied. */
const MIN_VISIBLE_HEADER_WIDTH = 200;

/** Duration (seconds) for the header slide animation. */
const HEADER_SLIDE_DURATION_S = 0.15;

/** Selects viewport transform from the React Flow store. */
const viewportSelector = (s: { transform: [number, number, number] }) => s.transform;

function ParentGroupComponent({ data, positionAbsoluteX }: NodeProps<ParentGroupNode>) {
  const colorClass = PARENT_GROUP_TYPE_COLORS[data.workItemType] ?? DEFAULT_PARENT_GROUP_TYPE_COLOR;

  const [viewX, , zoom] = useStore(viewportSelector);

  // Compute how far the header should offset to stay visible.
  // viewportLeft is the x coordinate of the left edge of the viewport in flow-space.
  const viewportLeft = -viewX / zoom;
  // Clamp offset so header stays between 0 and (width - minVisibleWidth)
  const maxOffset = Math.max(0, data.width - MIN_VISIBLE_HEADER_WIDTH);
  const rawOffset = viewportLeft - positionAbsoluteX;
  const headerOffset = Math.max(0, Math.min(maxOffset, rawOffset));

  return (
    <div
      className={`rounded-lg border-l-4 border-2 ${colorClass}`}
      style={{ width: data.width, height: data.height }}
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

      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-300/50 dark:border-gray-600/50 bg-gray-200/40 dark:bg-gray-700/40 rounded-t-lg"
        style={{
          position: "relative",
          left: headerOffset,
          width: data.width - headerOffset,
          transition: `left ${HEADER_SLIDE_DURATION_S}s ease-out, width ${HEADER_SLIDE_DURATION_S}s ease-out`,
        }}
      >
        <WorkItemTypeIcon workItemType={data.workItemType} className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
          {data.previewMode ? "Preview" : `#${data.workItemId}`}
        </span>
        <StateDropdown
          workItemId={data.workItemId}
          workItemType={data.workItemType}
          currentState={data.state}
          onStateChange={
            data.onPreviewStateChange
              ? (newState) => data.onPreviewStateChange?.(data.workItemId, newState)
              : undefined
          }
        />
        <WorkItemTitleButton
          onOpen={() => data.onOpenOverview?.(data.workItemId)}
          title={data.label}
          className="flex-1 truncate text-left text-xs text-gray-900 hover:underline dark:text-gray-100"
        >
          {data.label}
        </WorkItemTitleButton>
        {!data.previewMode && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onCreateChild?.(data.workItem);
            }}
            className="nodrag nopan rounded p-1 text-gray-500 hover:bg-black/10 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
            title="Create child work item"
            aria-label={`Create child work item for ${data.label}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleExpand?.(data.workItemId);
          }}
          className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 flex-shrink-0"
          title="Collapse"
        >
          {`▼ ${data.doneChildCount}/${data.childCount}`}
        </button>
      </div>
    </div>
  );
}

export default memo(ParentGroupComponent);
