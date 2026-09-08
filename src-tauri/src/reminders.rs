use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

const REMINDERS_FILE: &str = "reminders.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReminderStatus {
    Pending,
    Dismissed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub work_item_id: i64,
    pub title: String,
    pub body: String,
    pub due_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub status: ReminderStatus,
}

#[derive(Debug, Deserialize)]
pub struct CreateReminderRequest {
    pub work_item_id: i64,
    pub title: Option<String>,
    pub body: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
    pub delay_seconds: Option<i64>,
}

pub struct ReminderManager {
    reminders: Mutex<Vec<Reminder>>,
    file_path: PathBuf,
}

impl ReminderManager {
    pub fn new(data_dir: PathBuf) -> Arc<Self> {
        let file_path = data_dir.join(REMINDERS_FILE);
        let reminders = std::fs::read_to_string(&file_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Vec<Reminder>>(&content).ok())
            .unwrap_or_default();

        Arc::new(Self {
            reminders: Mutex::new(reminders),
            file_path,
        })
    }

    async fn save(&self, reminders: &[Reminder]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(reminders)
            .map_err(|error| format!("Failed to serialize reminders: {error}"))?;
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create reminders directory: {error}"))?;
        }
        std::fs::write(&self.file_path, json)
            .map_err(|error| format!("Failed to write reminders: {error}"))
    }

    pub async fn list(&self, work_item_id: Option<i64>) -> Vec<Reminder> {
        let reminders = self.reminders.lock().await;
        reminders
            .iter()
            .filter(|reminder| {
                work_item_id.map_or(true, |requested_id| requested_id == reminder.work_item_id)
            })
            .cloned()
            .collect()
    }

    pub async fn create(&self, request: CreateReminderRequest) -> Result<Reminder, String> {
        let due_at = match (request.due_at, request.delay_seconds) {
            (Some(due_at), None) => due_at,
            (None, Some(delay_seconds)) if delay_seconds > 0 => {
                Utc::now() + Duration::seconds(delay_seconds)
            }
            (Some(_), Some(_)) => {
                return Err("Provide either an exact time or a relative delay, not both".to_string())
            }
            (None, None) => return Err("A reminder time is required".to_string()),
            (None, Some(_)) => {
                return Err("The relative delay must be greater than zero".to_string())
            }
        };

        if due_at <= Utc::now() {
            return Err("The reminder time must be in the future".to_string());
        }

        let reminder = Reminder {
            id: format!("reminder-{}", uuid_like_id()),
            work_item_id: request.work_item_id,
            title: request
                .title
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| format!("Reminder for work item #{}", request.work_item_id)),
            body: request
                .body
                .filter(|body| !body.trim().is_empty())
                .unwrap_or_else(|| format!("Review work item #{}", request.work_item_id)),
            due_at,
            created_at: Utc::now(),
            status: ReminderStatus::Pending,
        };

        let mut reminders = self.reminders.lock().await;
        reminders.push(reminder.clone());
        self.save(&reminders).await?;
        Ok(reminder)
    }

    pub async fn delete(&self, reminder_id: &str) -> Result<(), String> {
        let mut reminders = self.reminders.lock().await;
        let original_length = reminders.len();
        reminders.retain(|reminder| reminder.id != reminder_id);
        if reminders.len() == original_length {
            return Err("Reminder not found".to_string());
        }
        self.save(&reminders).await
    }

    async fn due_pending(&self) -> Vec<Reminder> {
        let reminders = self.reminders.lock().await;
        let now = Utc::now();
        reminders
            .iter()
            .filter(|reminder| reminder.status == ReminderStatus::Pending && reminder.due_at <= now)
            .cloned()
            .collect()
    }
}

fn uuid_like_id() -> String {
    format!(
        "{}-{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id()
    )
}

#[tauri::command]
pub async fn list_reminders(
    state: tauri::State<'_, crate::state::AppState>,
    work_item_id: Option<i64>,
) -> Result<Vec<Reminder>, String> {
    Ok(state.reminder_manager.list(work_item_id).await)
}

#[tauri::command]
pub async fn create_reminder(
    state: tauri::State<'_, crate::state::AppState>,
    request: CreateReminderRequest,
) -> Result<Reminder, String> {
    state.reminder_manager.create(request).await
}

#[tauri::command]
pub async fn delete_reminder(
    state: tauri::State<'_, crate::state::AppState>,
    reminder_id: String,
) -> Result<(), String> {
    state.reminder_manager.delete(&reminder_id).await
}

pub fn start_scheduler<R: tauri::Runtime>(app_handle: AppHandle<R>, manager: Arc<ReminderManager>) {
    tauri::async_runtime::spawn(async move {
        loop {
            for reminder in manager.due_pending().await {
                let notification_result =
                    tauri_plugin_notification::NotificationExt::notification(&app_handle)
                        .builder()
                        .title(&reminder.title)
                        .body(&reminder.body)
                        .sound("Default")
                        .show();

                match notification_result {
                    Ok(()) => {
                        if let Err(error) = manager.delete(&reminder.id).await {
                            eprintln!("Failed to delete delivered reminder: {error}");
                        }
                    }
                    Err(error) => {
                        eprintln!("Failed to deliver reminder notification: {error}");
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("decent-ado-board-reminders-{suffix}"))
    }

    #[tokio::test]
    async fn creates_relative_reminder_as_absolute_time() {
        let directory = test_directory();
        let manager = ReminderManager::new(directory.clone());
        let before = Utc::now() + Duration::seconds(59);

        let reminder = manager
            .create(CreateReminderRequest {
                work_item_id: 42,
                title: Some("Review task".to_string()),
                body: Some("Check the board".to_string()),
                due_at: None,
                delay_seconds: Some(60),
            })
            .await
            .expect("reminder should be created");

        assert!(reminder.due_at >= before);
        assert_eq!(reminder.work_item_id, 42);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn rejects_past_exact_time() {
        let directory = test_directory();
        let manager = ReminderManager::new(directory.clone());

        let result = manager
            .create(CreateReminderRequest {
                work_item_id: 42,
                title: Some("Review task".to_string()),
                body: Some("Check the board".to_string()),
                due_at: Some(Utc::now() - Duration::minutes(1)),
                delay_seconds: None,
            })
            .await;

        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(directory);
    }
}
