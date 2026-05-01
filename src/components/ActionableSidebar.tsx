import type { BoardData, WorkItem } from "../types";
import {
  TYPE_COLORS,
  DEFAULT_TYPE_COLOR,
  STATE_BADGES,
  DEFAULT_STATE_BADGE,
} from "../utils/workItemColors";
import { computeActionableSet } from "../utils/actionable";

interface ActionableSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  boardData?: BoardData;
}

interface ActionableNode {
  workItem: WorkItem;
  children: ActionableNode[];
}

const STATE_SORT_PRIORITY: Record<string, number> = {
  "In Review": 0,
  Active: 1,
  "In Progress": 1,
  New: 2,
  "To Do": 2,
};

const DEFAULT_STATE_PRIORITY = 2;

function statePriority(state: string): number {
  return STATE_SORT_PRIORITY[state] ?? DEFAULT_STATE_PRIORITY;
}

function sortNodes(nodes: ActionableNode[]): void {
  nodes.sort((a, b) => statePriority(a.workItem.state) - statePriority(b.workItem.state));
  for (const node of nodes) {
    sortNodes(node.children);
  }
}

function countLeafItems(nodes: ActionableNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.children.length === 0) {
      count += 1;
    } else {
      count += countLeafItems(node.children);
    }
  }
  return count;
}

function buildActionableTree(boardData?: BoardData): ActionableNode[] {
  if (!boardData) {
    return [];
  }

  const workItemMap = new Map(boardData.work_items.map((workItem) => [workItem.id, workItem]));
  const actionableSet = computeActionableSet(boardData.work_items);

  // Group actionable items by parent
  const childrenByParent = new Map<number, WorkItem[]>();
  for (const workItem of boardData.work_items) {
    if (workItem.parent_id && actionableSet.has(workItem.id)) {
      const existing = childrenByParent.get(workItem.parent_id) ?? [];
      existing.push(workItem);
      childrenByParent.set(workItem.parent_id, existing);
    }
  }

  // Recursively build tree nodes
  const buildNode = (workItem: WorkItem): ActionableNode => {
    const childWorkItems = childrenByParent.get(workItem.id) ?? [];
    return {
      workItem,
      children: childWorkItems.map(buildNode),
    };
  };

  // Top-level: actionable items that have no parent, or whose parent is not in the tree
  const topLevel: ActionableNode[] = [];
  const hasParentInTree = new Set<number>();
  for (const [, children] of childrenByParent) {
    for (const child of children) {
      hasParentInTree.add(child.id);
    }
  }

  for (const id of actionableSet) {
    if (hasParentInTree.has(id)) {
      continue;
    }
    const workItem = workItemMap.get(id);
    if (!workItem) {
      continue;
    }
    topLevel.push(buildNode(workItem));
  }

  // Also add groups for non-actionable parents that have actionable children
  for (const [parentId, children] of childrenByParent) {
    if (actionableSet.has(parentId)) {
      continue;
    }
    const parent = workItemMap.get(parentId);
    if (!parent) {
      continue;
    }
    topLevel.push({
      workItem: parent,
      children: children.map(buildNode),
    });
  }

  sortNodes(topLevel);
  return topLevel;
}

function ActionableNodeCard({ node, depth }: { node: ActionableNode; depth: number }) {
  const colorClass = TYPE_COLORS[node.workItem.work_item_type] ?? DEFAULT_TYPE_COLOR;
  const stateClass = STATE_BADGES[node.workItem.state] ?? DEFAULT_STATE_BADGE;
  const compact = depth > 0;
  const padding = compact ? "px-2 py-1.5" : "p-3";

  return (
    <div className={`rounded border-l-4 ${padding} ${colorClass}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
          {`#${node.workItem.id}`}
        </span>
        <span className={`text-[10px] px-1 py-0.5 rounded ${stateClass}`}>
          {node.workItem.state}
        </span>
        {node.children.length > 0 && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-auto">
            {`${node.children.length} actionable`}
          </span>
        )}
      </div>
      <p
        className={`text-gray-900 dark:text-gray-100 leading-tight line-clamp-2 ${compact ? "text-xs" : "text-sm"}`}
        title={node.workItem.title}
      >
        {node.workItem.title}
      </p>
      {node.workItem.assigned_to && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 truncate">
          {node.workItem.assigned_to}
        </p>
      )}
      {node.children.length > 0 && (
        <div className="space-y-1.5 mt-2 ml-1">
          {node.children.map((child) => (
            <ActionableNodeCard key={child.workItem.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ActionableSidebar({ isOpen, onToggle, boardData }: ActionableSidebarProps) {
  const tree = buildActionableTree(boardData);
  const totalCount = countLeafItems(tree);

  return (
    <div
      className={`flex-shrink-0 border-l border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 transition-all duration-300 ${
        isOpen ? "w-80" : "w-10"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-center py-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isOpen ? "▶" : "◀"}
      </button>

      {isOpen && (
        <div className="p-4 overflow-y-auto h-[calc(100%-2.5rem)]">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">
            {`Ready to Work (${totalCount})`}
          </h2>
          {tree.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {"No actionable work items found."}
            </p>
          ) : (
            <div className="space-y-2">
              {tree.map((node) => (
                <ActionableNodeCard key={node.workItem.id} node={node} depth={0} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
