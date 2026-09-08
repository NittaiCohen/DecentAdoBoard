import { useState } from "react";
import { Bell } from "lucide-react";
import { createPortal } from "react-dom";
import ReminderPanel from "./ReminderPanel";

interface ReminderButtonProps {
  workItemId: number;
  workItemTitle: string;
  className?: string;
}

export default function ReminderButton({
  workItemId,
  workItemTitle,
  className = "",
}: ReminderButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(true);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={`rounded p-1 text-gray-500 hover:bg-black/10 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100 ${className}`}
        title="Set reminder"
        aria-label={`Set reminder for ${workItemTitle}`}
      >
        <Bell className="h-3.5 w-3.5" />
      </button>

      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsOpen(false);
              }
            }}
          >
            <div
              className="w-[92vw] max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100"
              role="dialog"
              aria-modal="true"
              aria-label="Set reminder"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <ReminderPanel workItemId={workItemId} onClose={() => setIsOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
