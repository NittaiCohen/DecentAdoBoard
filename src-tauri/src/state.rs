use crate::audit_log::AuditLog;
use crate::auth::OAuthTokens;
use crate::models::AdoConfig;
use tokio::sync::Mutex;

const TOKENS_FILE: &str = "auth_tokens.json";

pub struct AppState {
    pub config: std::sync::Mutex<Option<AdoConfig>>,
    pub token: Mutex<Option<OAuthTokens>>,
    pub http_client: reqwest::Client,
    pub audit_log: AuditLog,
    pub data_dir: std::path::PathBuf,
}

impl AppState {
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        let audit_log = AuditLog::new(&data_dir);
        Self {
            config: std::sync::Mutex::new(None),
            token: Mutex::new(None),
            http_client: reqwest::Client::builder()
                .user_agent("DecentAdoBoard/0.1")
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("failed to create HTTP client"),
            audit_log,
            data_dir,
        }
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
