import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createReminder, deleteReminder, listReminders } from "../api/tauri";
import type { Reminder } from "../types";

interface ReminderPanelProps {
  workItemId: number;
  onClose?: () => void;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const TWO_HOURS_IN_MINUTES = MINUTES_PER_HOUR + MINUTES_PER_HOUR;
const THREE_HOURS_IN_MINUTES = MINUTES_PER_HOUR + TWO_HOURS_IN_MINUTES;
const TODAY_OFFSET_DAYS = 0;
const TOMORROW_OFFSET_DAYS = 1;
const ONE_PM = 13;
const FIVE_PM = 17;
const NINE_AM = 9;

const RELATIVE_PRESETS = [
  { label: "5 minutes", minutes: 5 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: MINUTES_PER_HOUR },
  { label: "2 hours", minutes: TWO_HOURS_IN_MINUTES },
  { label: "3 hours", minutes: THREE_HOURS_IN_MINUTES },
];

interface ExactPreset {
  label: string;
  value: string;
}

function toUtcIso(localDateTime: string): string {
  return new Date(localDateTime).toISOString();
}

function formatDueAt(dueAt: string): string {
  return new Date(dueAt).toLocaleString();
}

function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getExactPresets(now: Date): ExactPreset[] {
  const presets = [
    { label: "Today at 1 PM", dayOffset: TODAY_OFFSET_DAYS, hour: ONE_PM },
    { label: "Today at 5 PM", dayOffset: TODAY_OFFSET_DAYS, hour: FIVE_PM },
    { label: "Tomorrow at 9 AM", dayOffset: TOMORROW_OFFSET_DAYS, hour: NINE_AM },
    { label: "Tomorrow at 1 PM", dayOffset: TOMORROW_OFFSET_DAYS, hour: ONE_PM },
    { label: "Tomorrow at 5 PM", dayOffset: TOMORROW_OFFSET_DAYS, hour: FIVE_PM },
  ];

  return presets.flatMap((preset) => {
    const date = new Date(now);
    date.setDate(date.getDate() + preset.dayOffset);
    date.setHours(preset.hour, 0, 0, 0);
    return date > now ? [{ label: preset.label, value: toLocalDateTimeValue(date) }] : [];
  });
}

export default function ReminderPanel({ workItemId, onClose }: ReminderPanelProps) {
  const queryClient = useQueryClient();
  const {
    data: reminders = [],
    isLoading,
    error,
  } = useQuery<Reminder[]>({
    queryKey: ["reminders", workItemId],
    queryFn: () => listReminders(workItemId),
  });
  const [scheduleMode, setScheduleMode] = useState<"relative" | "exact">("relative");
  const [delayMinutes, setDelayMinutes] = useState("30");
  const [exactDateTime, setExactDateTime] = useState("");
  const [currentTime] = useState(() => new Date());
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const pendingReminders = reminders.filter((reminder) => reminder.status === "pending");
  const exactPresets = getExactPresets(currentTime);

  async function addReminder() {
    setIsSaving(true);
    setActionError(null);
    try {
      await createReminder({
        work_item_id: workItemId,
        ...(scheduleMode === "relative"
          ? { delay_seconds: Number(delayMinutes) * SECONDS_PER_MINUTE }
          : { due_at: toUtcIso(exactDateTime) }),
      });
      await queryClient.invalidateQueries({ queryKey: ["reminders", workItemId] });
    } catch (createError) {
      setActionError(String(createError));
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(reminderId: string) {
    setActionError(null);
    try {
      await deleteReminder(reminderId);
      await queryClient.invalidateQueries({ queryKey: ["reminders", workItemId] });
    } catch (deleteError) {
      setActionError(String(deleteError));
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{"Reminders"}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {"Reminders are stored locally and will notify you after restarting the app."}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
              aria-label="Close reminder editor"
            >
              {"×"}
            </button>
          )}
        </div>
      </div>

      {pendingReminders.length > 0 && (
        <div className="space-y-2">
          {pendingReminders.map((reminder) => (
            <div
              key={reminder.id}
              className="flex items-center justify-between gap-3 rounded bg-gray-100 px-3 py-2 text-sm dark:bg-gray-800"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{reminder.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDueAt(reminder.due_at)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void remove(reminder.id)}
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                >
                  {"Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div
          className="inline-flex rounded-lg border border-gray-300 p-1 dark:border-gray-600"
          role="tablist"
          aria-label="Reminder schedule type"
        >
          {[
            { value: "relative", label: "Relative" },
            { value: "exact", label: "Exact" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={scheduleMode === option.value}
              onClick={() => {
                if (option.value === "relative" || option.value === "exact") {
                  setScheduleMode(option.value);
                }
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${
                scheduleMode === option.value
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {scheduleMode === "relative" ? (
            <div className="w-full space-y-2">
              <div className="flex flex-wrap gap-2">
                {RELATIVE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setDelayMinutes(String(preset.minutes))}
                    className={`rounded border px-2.5 py-1.5 text-sm ${
                      delayMinutes === String(preset.minutes)
                        ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                        : "border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {"Minutes from now"}
                </span>
                <input
                  type="number"
                  min="1"
                  value={delayMinutes}
                  onChange={(event) => setDelayMinutes(event.target.value)}
                  className="w-28 rounded border border-gray-300 bg-transparent px-2 py-1.5 dark:border-gray-600"
                />
              </label>
            </div>
          ) : (
            <div className="w-full space-y-2">
              {exactPresets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {exactPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setExactDateTime(preset.value)}
                      className={`rounded border px-2.5 py-1.5 text-sm ${
                        exactDateTime === preset.value
                          ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          : "border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {"Date and time"}
                </span>
                <input
                  type="datetime-local"
                  value={exactDateTime}
                  onChange={(event) => setExactDateTime(event.target.value)}
                  className="rounded border border-gray-300 bg-transparent px-2 py-1.5 dark:border-gray-600"
                />
              </label>
            </div>
          )}
          <button
            type="button"
            onClick={() => void addReminder()}
            disabled={
              isSaving ||
              (scheduleMode === "relative" ? Number(delayMinutes) <= 0 : exactDateTime.length === 0)
            }
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {isSaving ? "Adding..." : "Add reminder"}
          </button>
        </div>
      </div>

      {(error || actionError) && (
        <p className="text-sm text-red-600 dark:text-red-400">{String(actionError ?? error)}</p>
      )}

      {isLoading && <p className="text-xs text-gray-500">{"Loading reminders..."}</p>}
    </section>
  );
}
