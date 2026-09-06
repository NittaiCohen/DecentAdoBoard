import { memo } from "react";
import { Handle, Position, useStore, type NodeProps, type Node } from "@xyflow/react";

import StateDropdown from "./StateDropdown";
import type { BOARD_NODE_TYPES } from "../types/graph";

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

export type ParentGroupNode = Node<ParentGroupData, typeof BOARD_NODE_TYPES.parentGroup>;

const TYPE_COLORS: Record<string, string> = {
  Bug: "border-red-400/60 dark:border-red-600/60 border-l-red-500 bg-red-100/30 dark:bg-red-950/30",
  Task: "border-yellow-400/60 dark:border-yellow-600/60 border-l-yellow-500 bg-yellow-100/30 dark:bg-yellow-950/30",
  "User Story":
    "border-blue-400/60 dark:border-blue-600/60 border-l-blue-500 bg-blue-100/30 dark:bg-blue-950/30",
  Feature:
    "border-purple-400/60 dark:border-purple-600/60 border-l-purple-500 bg-purple-100/30 dark:bg-purple-950/30",
  Epic: "border-orange-400/60 dark:border-orange-600/60 border-l-orange-500 bg-orange-100/30 dark:bg-orange-950/30",
  "Product Backlog Item":
    "border-blue-400/60 dark:border-blue-600/60 border-l-blue-500 bg-blue-100/30 dark:bg-blue-950/30",
};

const DEFAULT_COLORS =
  "border-gray-400/60 dark:border-gray-600/60 border-l-gray-500 bg-gray-100/30 dark:bg-gray-800/30";

/** Minimum header width that must remain visible when offset is applied. */
const MIN_VISIBLE_HEADER_WIDTH = 200;

/** Duration (seconds) for the header slide animation. */
const HEADER_SLIDE_DURATION_S = 0.15;

/** Selects viewport transform from the React Flow store. */
const viewportSelector = (s: { transform: [number, number, number] }) => s.transform;

function ParentGroupComponent({ data, positionAbsoluteX }: NodeProps<ParentGroupNode>) {
  const colorClass = TYPE_COLORS[data.workItemType] ?? DEFAULT_COLORS;

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
        className="!bg-gray-500 dark:!bg-gray-400 !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Right}
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
        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{`#${data.workItemId}`}</span>
        <StateDropdown
          workItemId={data.workItemId}
          workItemType={data.workItemType}
          currentState={data.state}
        />
        <span
          className="text-xs text-gray-900 dark:text-gray-100 truncate flex-1"
          title={data.label}
        >
          {data.label}
        </span>
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
