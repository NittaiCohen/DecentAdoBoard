use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Actions that can be performed on work items, each carrying the data needed to revert it.
///
/// Serializes with an `"action"` tag field via `#[serde(tag = "action")]`.
/// When flattened into `AuditEntry`, produces a single flat JSON object:
/// `{"timestamp":"...","work_item_id":42,"action":"update_state","old":"Active","new":"Resolved"}`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AuditAction {
    UpdateState {
        old: String,
        new: String,
    },
    UpdateTitle {
        old: String,
        new: String,
    },
    UpdateDescription {
        old: String,
        new: String,
    },
    UpdateIteration {
        old: String,
        new: String,
    },
    AddDependency {
        predecessor_id: i64,
    },
    RemoveDependency {
        predecessor_id: i64,
    },
    Create {
        title: String,
        work_item_type: String,
        iteration: String,
    },
    Restore {
        previous_state: String,
    },
}

/// A single audit log entry persisted as one JSONL line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub work_item_id: i64,
    /// The action performed, flattened so its fields appear at the top level of the JSON line.
    #[serde(flatten)]
    pub action: AuditAction,
}

/// Append-only JSONL audit log writer.
/// The log file is meant to be read by external correction scripts, not by the app itself.
pub struct AuditLog {
    path: Mutex<PathBuf>,
}

impl AuditLog {
    /// Create a new audit log that writes to the given directory.
    /// The log file will be `<dir>/audit_log.jsonl`.
    pub fn new(dir: &Path) -> Self {
        Self {
            path: Mutex::new(dir.join("audit_log.jsonl")),
        }
    }

    /// Append an entry to the log file. Creates the file (and parent dirs) if missing.
    pub fn log(&self, action: AuditAction, work_item_id: i64) -> Result<(), String> {
        let entry = AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            work_item_id,
            action,
        };

        let line =
            serde_json::to_string(&entry).map_err(|e| format!("Failed to serialize entry: {e}"))?;

        let path = self.path.lock().map_err(|e| format!("Lock error: {e}"))?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create log directory: {e}"))?;
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&*path)
            .map_err(|e| format!("Failed to open audit log: {e}"))?;

        writeln!(file, "{line}").map_err(|e| format!("Failed to write audit entry: {e}"))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_log_dir() -> PathBuf {
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("audit_log_test_{}_{id}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Read raw JSONL lines from the log file for test assertions.
    fn read_entries(dir: &Path) -> Vec<AuditEntry> {
        let path = dir.join("audit_log.jsonl");
        let contents = fs::read_to_string(path).unwrap_or_default();
        contents
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    }

    #[test]
    fn creates_file_and_appends_entry() {
        let dir = temp_log_dir();
        let log = AuditLog::new(&dir);

        log.log(
            AuditAction::UpdateState {
                old: "Active".into(),
                new: "Resolved".into(),
            },
            42,
        )
        .unwrap();

        let entries = read_entries(&dir);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].action,
            AuditAction::UpdateState {
                old: "Active".into(),
                new: "Resolved".into(),
            }
        );
        assert_eq!(entries[0].work_item_id, 42);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn appends_multiple_entries() {
        let dir = temp_log_dir();
        let log = AuditLog::new(&dir);

        log.log(
            AuditAction::UpdateTitle {
                old: "old title".into(),
                new: "new title".into(),
            },
            1,
        )
        .unwrap();
        log.log(AuditAction::AddDependency { predecessor_id: 99 }, 2)
            .unwrap();
        log.log(
            AuditAction::UpdateState {
                old: "Active".into(),
                new: "Removed".into(),
            },
            3,
        )
        .unwrap();

        let entries = read_entries(&dir);
        assert_eq!(entries.len(), 3);
        assert_eq!(
            entries[0].action,
            AuditAction::UpdateTitle {
                old: "old title".into(),
                new: "new title".into(),
            }
        );
        assert_eq!(
            entries[1].action,
            AuditAction::AddDependency { predecessor_id: 99 }
        );
        assert_eq!(
            entries[2].action,
            AuditAction::UpdateState {
                old: "Active".into(),
                new: "Removed".into(),
            }
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn entries_contain_valid_timestamp() {
        let dir = temp_log_dir();
        let log = AuditLog::new(&dir);

        log.log(
            AuditAction::UpdateIteration {
                old: "Sprint 1".into(),
                new: "Sprint 2".into(),
            },
            5,
        )
        .unwrap();

        let entries = read_entries(&dir);
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].timestamp.is_empty());
        assert!(chrono::DateTime::parse_from_rfc3339(&entries[0].timestamp).is_ok());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn all_actions_serialize_and_round_trip() {
        let dir = temp_log_dir();
        let log = AuditLog::new(&dir);

        let actions = [
            AuditAction::UpdateState {
                old: "New".into(),
                new: "Active".into(),
            },
            AuditAction::UpdateTitle {
                old: "a".into(),
                new: "b".into(),
            },
            AuditAction::UpdateDescription {
                old: "desc1".into(),
                new: "desc2".into(),
            },
            AuditAction::UpdateIteration {
                old: "S1".into(),
                new: "S2".into(),
            },
            AuditAction::AddDependency { predecessor_id: 10 },
            AuditAction::RemoveDependency { predecessor_id: 20 },
            AuditAction::Create {
                title: "New task".into(),
                work_item_type: "Task".into(),
                iteration: "Sprint 3".into(),
            },
            AuditAction::Restore {
                previous_state: "Removed".into(),
            },
        ];

        for (i, action) in actions.iter().enumerate() {
            log.log(action.clone(), i as i64).unwrap();
        }

        let entries = read_entries(&dir);
        assert_eq!(entries.len(), actions.len());

        for (entry, expected) in entries.iter().zip(actions.iter()) {
            assert_eq!(&entry.action, expected);
        }

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn json_output_is_flat() {
        let entry = AuditEntry {
            timestamp: "2026-01-01T00:00:00Z".into(),
            work_item_id: 42,
            action: AuditAction::UpdateState {
                old: "Active".into(),
                new: "Resolved".into(),
            },
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify flat structure (action fields at top level, not nested)
        assert_eq!(parsed["action"], "update_state");
        assert_eq!(parsed["old"], "Active");
        assert_eq!(parsed["new"], "Resolved");
        assert_eq!(parsed["work_item_id"], 42);
        assert_eq!(parsed["timestamp"], "2026-01-01T00:00:00Z");
    }
}
