import { useState, type MouseEvent } from "react";
import { Bell, BellRing } from "lucide-react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clearTriggeredReminders } from "../api/tauri";
import type { Reminder } from "../types";
import ReminderPanel from "./ReminderPanel";

interface ReminderButtonProps {
  workItemId: number;
  workItemTitle: string;
  isTriggered?: boolean;
  className?: string;
}

export default function ReminderButton({
  workItemId,
  workItemTitle,
  isTriggered = false,
  className = "",
}: ReminderButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  async function openReminderEditor(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (isTriggered) {
      try {
        await clearTriggeredReminders(workItemId);
        queryClient.setQueryData<Reminder[]>(["reminders"], (reminders) =>
          reminders?.filter(
            (reminder) => reminder.work_item_id !== workItemId || reminder.status !== "triggered",
          ),
        );
        queryClient.setQueryData<Reminder[]>(["reminders", workItemId], (reminders) =>
          reminders?.filter((reminder) => reminder.status !== "triggered"),
        );
        await queryClient.invalidateQueries({ queryKey: ["reminders"] });
        await queryClient.invalidateQueries({ queryKey: ["reminders", workItemId] });
        return;
      } catch (clearError) {
        console.error("Failed to clear triggered reminder", clearError);
      }
    }
    setIsOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => void openReminderEditor(event)}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={`nodrag nopan rounded p-1 text-gray-500 hover:bg-black/10 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100 ${className}`}
        title={isTriggered ? "Clear reminder notification" : "Set reminder"}
        aria-label={`${isTriggered ? "Clear reminder notification" : "Set reminder"} for ${workItemTitle}`}
      >
        {isTriggered ? (
          <BellRing className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
        ) : (
          <Bell className="h-3.5 w-3.5" />
        )}
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
