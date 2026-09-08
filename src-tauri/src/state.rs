use crate::audit_log::AuditLog;
use crate::auth::OAuthTokens;
use crate::models::{AdoConfig, AdoWorkItemFieldDefinition};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

const TOKENS_FILE: &str = "auth_tokens.json";
const ICON_CACHE_FILE: &str = "work_item_icon_cache.json";
const WORK_ITEM_FIELDS_CACHE_FILE: &str = "work_item_fields_cache.json";
const ICON_CACHE_TTL: Duration = Duration::days(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedWorkItemIcon {
    pub data_url: String,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedWorkItemFields {
    pub field_definitions: Vec<AdoWorkItemFieldDefinition>,
    pub fetched_at: DateTime<Utc>,
}

pub struct AppState {
    pub config: std::sync::Mutex<Option<AdoConfig>>,
    pub token: Arc<Mutex<Option<OAuthTokens>>>,
    pub http_client: reqwest::Client,
    pub audit_log: AuditLog,
    pub data_dir: std::path::PathBuf,
    pub icon_cache: Mutex<HashMap<String, CachedWorkItemIcon>>,
    pub work_item_fields_cache: Arc<Mutex<HashMap<String, CachedWorkItemFields>>>,
}

impl AppState {
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        let audit_log = AuditLog::new(&data_dir);
        let icon_cache = Self::load_icon_cache(&data_dir);
        let work_item_fields_cache = Self::load_work_item_fields_cache(&data_dir);
        Self {
            config: std::sync::Mutex::new(None),
            token: Arc::new(Mutex::new(None)),
            http_client: reqwest::Client::builder()
                .user_agent("DecentAdoBoard/0.1")
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("failed to create HTTP client"),
            audit_log,
            data_dir,
            icon_cache: Mutex::new(icon_cache),
            work_item_fields_cache: Arc::new(Mutex::new(work_item_fields_cache)),
        }
    }

    fn icon_cache_path(data_dir: &std::path::Path) -> std::path::PathBuf {
        data_dir.join(ICON_CACHE_FILE)
    }

    fn load_icon_cache(data_dir: &std::path::Path) -> HashMap<String, CachedWorkItemIcon> {
        let Ok(content) = std::fs::read_to_string(Self::icon_cache_path(data_dir)) else {
            return HashMap::new();
        };
        let Ok(cache) = serde_json::from_str::<HashMap<String, CachedWorkItemIcon>>(&content)
        else {
            return HashMap::new();
        };
        let cutoff = Utc::now() - ICON_CACHE_TTL;
        cache
            .into_iter()
            .filter(|(_, icon)| icon.fetched_at > cutoff)
            .collect()
    }

    fn work_item_fields_cache_path(data_dir: &Path) -> std::path::PathBuf {
        data_dir.join(WORK_ITEM_FIELDS_CACHE_FILE)
    }

    fn load_work_item_fields_cache(data_dir: &Path) -> HashMap<String, CachedWorkItemFields> {
        let Ok(content) = std::fs::read_to_string(Self::work_item_fields_cache_path(data_dir))
        else {
            return HashMap::new();
        };
        serde_json::from_str(&content).unwrap_or_default()
    }

    pub async fn get_cached_work_item_fields(
        &self,
        cache_key: &str,
        work_item_types: &[String],
    ) -> Option<HashMap<String, Vec<AdoWorkItemFieldDefinition>>> {
        let cache = self.work_item_fields_cache.lock().await;
        let mut definitions = HashMap::new();
        for work_item_type in work_item_types {
            let entry = cache.get(&format!("{cache_key}:{work_item_type}"))?;
            definitions.insert(work_item_type.clone(), entry.field_definitions.clone());
        }
        Some(definitions)
    }

    pub async fn save_work_item_fields(
        &self,
        cache_key: &str,
        definitions: &HashMap<String, Vec<AdoWorkItemFieldDefinition>>,
    ) -> Result<(), String> {
        Self::save_work_item_fields_cache(
            &self.work_item_fields_cache,
            &self.data_dir,
            cache_key,
            definitions,
        )
        .await
    }

    pub async fn cache_work_item_icon(
        &self,
        cache_key: String,
        icon: CachedWorkItemIcon,
    ) -> Result<(), String> {
        let mut cache = self.icon_cache.lock().await;
        cache.insert(cache_key, icon);
        let json = serde_json::to_string(&*cache)
            .map_err(|e| format!("Failed to serialize work item icon cache: {e}"))?;
        std::fs::create_dir_all(&self.data_dir)
            .map_err(|e| format!("Failed to create icon cache directory: {e}"))?;
        std::fs::write(Self::icon_cache_path(&self.data_dir), json)
            .map_err(|e| format!("Failed to write work item icon cache: {e}"))
    }

    pub async fn save_work_item_fields_cache(
        cache: &Arc<Mutex<HashMap<String, CachedWorkItemFields>>>,
        data_dir: &Path,
        cache_key: &str,
        definitions: &HashMap<String, Vec<AdoWorkItemFieldDefinition>>,
    ) -> Result<(), String> {
        let mut cache_guard = cache.lock().await;
        for (work_item_type, field_definitions) in definitions {
            cache_guard.insert(
                format!("{cache_key}:{work_item_type}"),
                CachedWorkItemFields {
                    field_definitions: field_definitions.clone(),
                    fetched_at: Utc::now(),
                },
            );
        }
        let json = serde_json::to_string(&*cache_guard)
            .map_err(|e| format!("Failed to serialize work item field cache: {e}"))?;
        std::fs::create_dir_all(data_dir)
            .map_err(|e| format!("Failed to create work item field cache directory: {e}"))?;
        std::fs::write(AppState::work_item_fields_cache_path(data_dir), json)
            .map_err(|e| format!("Failed to write work item field cache: {e}"))
    }

    pub async fn get_cached_work_item_icon(&self, cache_key: &str) -> Option<String> {
        let cache = self.icon_cache.lock().await;
        let cached_icon = cache.get(cache_key)?;
        if cached_icon.fetched_at <= Utc::now() - ICON_CACHE_TTL {
            return None;
        }
        Some(cached_icon.data_url.clone())
    }

    pub fn get_config(&self) -> Result<AdoConfig, String> {
        let config = self
            .config
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        config.clone().ok_or("ADO not configured".to_string())
    }

    fn tokens_path(&self) -> std::path::PathBuf {
        self.data_dir.join(TOKENS_FILE)
    }

    pub async fn save_tokens_to_disk(&self) {
        let guard = self.token.lock().await;
        if let Some(tokens) = guard.as_ref() {
            if let Ok(json) = serde_json::to_string_pretty(tokens) {
                let _ = std::fs::create_dir_all(&self.data_dir);
                let _ = std::fs::write(self.tokens_path(), json);
            }
        }
    }

    pub async fn load_tokens_from_disk(&self) -> bool {
        let path = self.tokens_path();
        let Ok(content) = std::fs::read_to_string(&path) else {
            return false;
        };
        let Ok(tokens) = serde_json::from_str::<OAuthTokens>(&content) else {
            return false;
        };
        let mut guard = self.token.lock().await;
        *guard = Some(tokens);
        true
    }

    pub async fn clear_tokens(&self) {
        let mut guard = self.token.lock().await;
        *guard = None;
        drop(guard);
        let _ = std::fs::remove_file(self.tokens_path());
    }

    pub async fn get_bearer_token(&self) -> Result<String, String> {
        use crate::auth::AuthSource;

        enum Action {
            ReturnBasic(String),  // PAT — return Basic auth header
            ReturnBearer(String), // valid token — return as-is
            RefreshAzCli,         // AzCli token expired — re-acquire
            RefreshOAuth(String), // OAuth token expired — use refresh_token
            SessionExpired,       // OAuth token expired with no refresh_token
        }

        let action = {
            let guard = self.token.lock().await;
            let token = guard
                .as_ref()
                .ok_or_else(|| "Not authenticated. Please sign in.".to_string())?;

            match &token.source {
                AuthSource::Pat => Action::ReturnBasic(token.access_token.clone()),
                AuthSource::OAuthBrowser | AuthSource::AzCli => {
                    let threshold = chrono::Utc::now() + chrono::Duration::seconds(300);
                    if token.expires_at > threshold {
                        Action::ReturnBearer(token.access_token.clone())
                    } else if token.source == AuthSource::AzCli {
                        Action::RefreshAzCli
                    } else {
                        match token.refresh_token.clone() {
                            Some(rt) => Action::RefreshOAuth(rt),
                            None => Action::SessionExpired,
                        }
                    }
                }
            }
        };

        match action {
            Action::ReturnBasic(pat) => {
                use base64::Engine as _;
                let encoded = base64::engine::general_purpose::STANDARD.encode(format!(":{pat}"));
                Ok(format!("Basic {encoded}"))
            }
            Action::ReturnBearer(token) => Ok(format!("Bearer {token}")),
            Action::RefreshAzCli => {
                let new_tokens = crate::auth::get_az_cli_token().await?;
                let bearer = format!("Bearer {}", new_tokens.access_token);
                *self.token.lock().await = Some(new_tokens);
                self.save_tokens_to_disk().await;
                Ok(bearer)
            }
            Action::RefreshOAuth(refresh_token) => {
                let new_tokens =
                    crate::auth::refresh_access_token(&self.http_client, &refresh_token)
                        .await
                        .map_err(|e| {
                            format!("Token refresh failed. Please sign in again. ({e})")
                        })?;
                let bearer = format!("Bearer {}", new_tokens.access_token);
                *self.token.lock().await = Some(new_tokens);
                self.save_tokens_to_disk().await;
                Ok(bearer)
            }
            Action::SessionExpired => Err("Session expired. Please sign in again.".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state() -> AppState {
        AppState::new(
            std::env::current_dir()
                .unwrap()
                .join("target")
                .join("state_test_data"),
        )
    }

    #[test]
    fn get_config_without_config() {
        let state = test_state();
        let result = state.get_config();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "ADO not configured");
    }

    #[test]
    fn get_config_with_config() {
        let state = test_state();
        *state.config.lock().unwrap() = Some(AdoConfig {
            organization: "myorg".to_string(),
            project: "myproj".to_string(),
            area_path: "myarea".to_string(),
        });
        let config = state.get_config().unwrap();
        assert_eq!(config.organization, "myorg");
        assert_eq!(config.project, "myproj");
        assert_eq!(config.area_path, "myarea");
    }
}
