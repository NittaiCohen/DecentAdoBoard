use tauri::State;

use crate::ado_client;
use crate::auth;
use crate::models::*;
use crate::state::AppState;

#[tauri::command]
pub async fn set_config(
    state: State<'_, AppState>,
    organization: String,
    project: String,
    area_path: String,
) -> Result<(), String> {
    let config = AdoConfig {
        organization,
        project,
        area_path,
    };

    *state
        .config
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = Some(config);

    Ok(())
}

#[tauri::command]
pub async fn get_board_data(state: State<'_, AppState>) -> Result<BoardData, String> {
    let iterations = ado_client::fetch_iterations(&state).await?;
    let work_items = ado_client::fetch_work_items(&state).await?;

    Ok(BoardData {
        work_items,
        iterations,
    })
}

fn parse_and_sort_accounts(resp_text: &str) -> Result<Vec<AccountInfo>, String> {
    let mut accounts = if let Ok(wrapped) = serde_json::from_str::<AccountsResponse>(resp_text) {
        wrapped.value.unwrap_or_default()
    } else if let Ok(accts) = serde_json::from_str::<Vec<AccountInfo>>(resp_text) {
        accts
    } else {
        return Err(format!(
            "Failed to parse organizations response: {}",
            resp_text
        ));
    };
    accounts.sort_by(|a, b| {
        a.account_name
            .to_lowercase()
            .cmp(&b.account_name.to_lowercase())
    });
    Ok(accounts)
}

pub(crate) async fn discover_orgs_via_entra(
    client: &reqwest::Client,
    auth_header: &str,
) -> Result<Vec<AccountInfo>, String> {
    let resp = client
        .get("https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1")
        .header("Authorization", auth_header)
        .send()
        .await
        .map_err(|e| format!("Profile request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Profile").await?;

    let profile: ProfileResponse = resp
        .json()
        .await
        .map_err(|e| format!("Profile parse error: {e}"))?;

    let url = format!(
        "https://app.vssps.visualstudio.com/_apis/accounts?memberId={}&api-version=7.1",
        profile.id
    );

    let resp = client
        .get(&url)
        .header("Authorization", auth_header)
        .send()
        .await
        .map_err(|e| format!("Accounts request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Accounts").await?;

    let resp_text = resp.text().await.map_err(|e| format!("Read error: {e}"))?;

    parse_and_sort_accounts(&resp_text)
}

#[tauri::command]
pub async fn login_az_cli(state: State<'_, AppState>) -> Result<(), String> {
    let tokens = auth::get_az_cli_token().await?;
    *state.token.lock().await = Some(tokens);
    state.save_tokens_to_disk().await;
    Ok(())
}

#[tauri::command]
pub async fn set_pat(state: State<'_, AppState>, pat: String) -> Result<(), String> {
    let tokens = auth::pat_tokens(pat);
    {
        let mut guard = state.token.lock().await;
        *guard = Some(tokens);
    }
    state.save_tokens_to_disk().await;
    Ok(())
}

#[tauri::command]
pub async fn login_microsoft(state: State<'_, AppState>) -> Result<(), String> {
    let tokens = auth::login_browser(&state.http_client).await?;
    {
        let mut guard = state.token.lock().await;
        *guard = Some(tokens);
    }
    state.save_tokens_to_disk().await;
    Ok(())
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    state.clear_tokens().await;
    Ok(())
}

#[tauri::command]
pub async fn check_auth(state: State<'_, AppState>) -> Result<bool, String> {
    let has_token_in_memory = {
        let guard = state.token.lock().await;
        guard.is_some()
    };

    if has_token_in_memory {
        return match state.get_bearer_token().await {
            Ok(_) => Ok(true),
            Err(_) => {
                state.clear_tokens().await;
                Ok(false)
            }
        };
    }

    if state.load_tokens_from_disk().await {
        return match state.get_bearer_token().await {
            Ok(_) => Ok(true),
            Err(_) => {
                state.clear_tokens().await;
                Ok(false)
            }
        };
    }

    Ok(false)
}

#[tauri::command]
pub async fn list_organizations(state: State<'_, AppState>) -> Result<Vec<AccountInfo>, String> {
    let auth = state.get_bearer_token().await?;
    discover_orgs_via_entra(&state.http_client, &auth).await
}

#[tauri::command]
pub async fn list_projects(
    state: State<'_, AppState>,
    organization: String,
) -> Result<Vec<ProjectInfo>, String> {
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/_apis/projects?api-version=7.1&$top=200",
        organization
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Projects request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Projects").await?;

    let data: ProjectsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Projects parse error: {e}"))?;

    Ok(data.value)
}

#[tauri::command]
pub async fn list_teams(
    state: State<'_, AppState>,
    organization: String,
    project: String,
) -> Result<Vec<TeamInfo>, String> {
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/_apis/projects/{}/teams?api-version=7.1&$top=200",
        organization, project
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Teams request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Teams").await?;

    let data: TeamsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Teams parse error: {e}"))?;

    Ok(data.value)
}

#[tauri::command]
pub async fn list_area_paths(
    state: State<'_, AppState>,
    organization: String,
    project: String,
) -> Result<Vec<String>, String> {
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/classificationnodes/Areas?$depth=10&api-version=7.1",
        organization, project
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Area paths request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Area paths").await?;

    let data: ClassificationNodeResponse = resp
        .json()
        .await
        .map_err(|e| format!("Area paths parse error: {e}"))?;

    let mut paths = Vec::new();
    flatten_area_paths(&data, "", &mut paths);
    Ok(paths)
}

fn flatten_area_paths(node: &ClassificationNodeResponse, prefix: &str, paths: &mut Vec<String>) {
    let full_path = if prefix.is_empty() {
        node.name.clone()
    } else {
        format!("{}\\{}", prefix, node.name)
    };
    paths.push(full_path.clone());

    if let Some(children) = &node.children {
        for child in children {
            flatten_area_paths(child, &full_path, paths);
        }
    }
}

#[tauri::command]
pub async fn write_debug_log(state: State<'_, AppState>, data: String) -> Result<String, String> {
    let path = state.data_dir.join("layout_debug.json");
    std::fs::create_dir_all(&state.data_dir).map_err(|e| format!("mkdir error: {e}"))?;
    std::fs::write(&path, &data).map_err(|e| format!("write error: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}
