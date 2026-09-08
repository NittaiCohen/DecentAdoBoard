export type ReminderStatus = "pending" | "triggered" | "cleared" | "dismissed";

export interface Reminder {
  id: string;
  work_item_id: number;
  title: string;
  body: string;
  due_at: string;
  created_at: string;
  status: ReminderStatus;
}

export interface CreateReminderRequest {
  work_item_id: number;
  title?: string;
  body?: string;
  due_at?: string;
  delay_seconds?: number;
}
