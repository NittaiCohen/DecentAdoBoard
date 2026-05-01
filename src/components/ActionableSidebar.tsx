import type { BoardData, WorkItem } from "../types";

interface ActionableSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  boardData?: BoardData;
}

function getActionableItems(boardData?: BoardData): WorkItem[] {
  if (!boardData) return [];

  const stateMap = new Map(boardData.work_items.map((wi) => [wi.id, wi.state]));

  const doneStates = new Set(["Done", "Closed", "Resolved", "Removed"]);

  return boardData.work_items.filter((wi) => {
    if (doneStates.has(wi.state)) return false;
    if (wi.predecessors.length === 0) return true;
    return wi.predecessors.every((predId) => {
      const predState = stateMap.get(predId);
      return predState && doneStates.has(predState);
    });
  });
}

export default function ActionableSidebar({ isOpen, onToggle, boardData }: ActionableSidebarProps) {
  const actionableItems = getActionableItems(boardData);

  return (
    <div
      className={`flex-shrink-0 border-l border-gray-700 bg-gray-800 transition-all duration-300 ${
        isOpen ? "w-80" : "w-10"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-center py-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
        title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isOpen ? "▶" : "◀"}
      </button>

      {isOpen && (
        <div className="p-4 overflow-y-auto h-[calc(100%-2.5rem)]">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
            Ready to Work ({actionableItems.length})
          </h2>
          {actionableItems.length === 0 ? (
            <p className="text-sm text-gray-500">No actionable work items found.</p>
          ) : (
            <div className="space-y-2">
              {actionableItems.map((item) => (
                <div key={item.id} className="bg-gray-700 rounded p-3 border border-gray-600">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400">#{item.id}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-600 text-gray-300">
                      {item.work_item_type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-100 leading-tight">{item.title}</p>
                  {item.assigned_to && (
                    <p className="text-xs text-gray-400 mt-1">{item.assigned_to}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
