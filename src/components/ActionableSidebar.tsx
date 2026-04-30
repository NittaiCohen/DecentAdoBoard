interface ActionableSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export default function ActionableSidebar({
  isOpen,
  onToggle,
}: ActionableSidebarProps) {
  return (
    <div
      className={`flex-shrink-0 border-l border-gray-700 bg-gray-800 transition-all duration-300 ${
        isOpen ? "w-80" : "w-10"
      }`}
    >
      {/* Toggle button */}
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
            Ready to Work
          </h2>
          <p className="text-sm text-gray-500">
            Work items with all predecessors completed will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
