use tauri::State;

use crate::ado_client;
use crate::auth;
use crate::models::*;
use crate::state::{AppState, CachedWorkItemIcon};
use base64::Engine;
use chrono::Utc;

const MAX_PROJECT_TAG_SEARCH_RESULTS: usize = 50;
const MAX_COMMENT_PARSE_ERROR_BODY_LENGTH: usize = 8_000;

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
pub async fn get_board_work_item_types(
    state: State<'_, AppState>,
) -> Result<Vec<BoardWorkItemType>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitemtypes?api-version=7.1",
        config.organization, config.project
    );

    let response = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Board work item types request failed: {e}"))?;
    let response = ado_client::check_response(response, "Board work item types").await?;
    let response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Board work item types parse error: {e}"))?;

    let types = response["value"]
        .as_array()
        .ok_or_else(|| "Board work item types response did not contain a value array".to_string())?
        .iter()
        .filter_map(|work_item_type| {
            Some(BoardWorkItemType {
                name: work_item_type.get("name")?.as_str()?.to_string(),
                reference_name: work_item_type.get("referenceName")?.as_str()?.to_string(),
                icon_id: work_item_type
                    .get("icon")
                    .and_then(|icon| icon.get("id"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                color: work_item_type
                    .get("color")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            })
        })
        .collect::<Vec<_>>();

    Ok(types)
}

#[tauri::command]
pub async fn get_work_item_type_icon(
    state: State<'_, AppState>,
    icon_id: String,
    color: String,
) -> Result<String, String> {
    let config = state.get_config()?;
    let normalized_color = color.trim_start_matches('#').to_string();
    let cache_key = format!("{}:{}:{}", config.organization, icon_id, normalized_color);
    if let Some(data_url) = state.get_cached_work_item_icon(&cache_key).await {
        return Ok(data_url);
    }

    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/_apis/wit/workitemicons/{}?color={}&v=1&api-version=7.1",
        config.organization,
        urlencoding::encode(&icon_id),
        urlencoding::encode(&normalized_color),
    );
    let response = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Work item icon request failed: {e}"))?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/svg+xml")
        .to_string();
    let response = ado_client::check_response(response, "Work item icon").await?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Work item icon response read error: {e}"))?;

    let data_url = format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes),
    );
    state
        .cache_work_item_icon(
            cache_key,
            CachedWorkItemIcon {
                data_url: data_url.clone(),
                fetched_at: Utc::now(),
            },
        )
        .await?;

    Ok(data_url)
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

#[tauri::command]
pub async fn get_work_item_overview(
    state: State<'_, AppState>,
    work_item_id: i64,
) -> Result<WorkItemOverview, String> {
    ado_client::fetch_work_item_overview(&state, work_item_id).await
}

#[tauri::command]
pub async fn get_work_item_type_fields(
    state: State<'_, AppState>,
    work_item_type: String,
) -> Result<Vec<AdoWorkItemFieldDefinition>, String> {
    ado_client::fetch_work_item_type_fields(&state, &work_item_type).await
}

#[tauri::command]
pub async fn get_work_item_type_fields_batch(
    state: State<'_, AppState>,
    work_item_types: Vec<String>,
) -> Result<WorkItemTypeFieldsBatchResult, String> {
    ado_client::fetch_work_item_type_fields_batch(&state, &work_item_types).await
}

#[tauri::command]
pub async fn refresh_work_item_type_fields_batch(
    state: State<'_, AppState>,
    work_item_types: Vec<String>,
) -> Result<std::collections::HashMap<String, Vec<AdoWorkItemFieldDefinition>>, String> {
    let config = state.get_config()?;
    let cache_key = format!("{}/{}", config.organization, config.project);
    ado_client::refresh_work_item_type_fields_batch(&state, &work_item_types, &config, &cache_key)
        .await
}

#[tauri::command]
pub async fn get_work_item_comments(
    state: State<'_, AppState>,
    work_item_id: i64,
) -> Result<Vec<WorkItemComment>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workItems/{}/comments?$expand=renderedText&order=desc&api-version=7.1-preview.4",
        config.organization, config.project, work_item_id
    );

    let response = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Work item comments request failed: {e}"))?;
    let response = ado_client::check_response(response, "Work item comments").await?;
    let response_body = response
        .text()
        .await
        .map_err(|e| format!("Work item comments response read error: {e}"))?;
    let data: WorkItemCommentsResponse = serde_json::from_str(&response_body)
        .map_err(|e| {
            let response_preview: String = response_body
                .chars()
                .take(MAX_COMMENT_PARSE_ERROR_BODY_LENGTH)
                .collect();
            let truncation_suffix = if response_body.chars().count() > MAX_COMMENT_PARSE_ERROR_BODY_LENGTH {
                "... [response truncated]"
            } else {
                ""
            };

            format!(
                "Work item comments response parse error: {e}; response body: {response_preview}{truncation_suffix}"
            )
        })?;

    Ok(data
        .comments
        .into_iter()
        .map(|comment| WorkItemComment {
            id: comment.id,
            text: comment.text,
            rendered_text: comment.rendered_text,
            created_by: comment
                .created_by
                .map(|identity| identity.display_name)
                .unwrap_or_else(|| "Unknown user".to_string()),
            created_date: comment.created_date,
            is_deleted: comment.is_deleted,
        })
        .collect())
}

#[tauri::command]
pub async fn add_work_item_comment(
    state: State<'_, AppState>,
    work_item_id: i64,
    text: String,
) -> Result<(), String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workItems/{}/comments?format=html&api-version=7.1-preview.4",
        config.organization, config.project, work_item_id
    );

    let response = state
        .http_client
        .post(&url)
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "text": text }))
        .send()
        .await
        .map_err(|e| format!("Add work item comment request failed: {e}"))?;
    ado_client::check_response(response, "Add work item comment").await?;

    Ok(())
}

#[tauri::command]
pub async fn search_identities(
    state: State<'_, AppState>,
    search_text: String,
) -> Result<Vec<IdentitySearchResult>, String> {
    ado_client::search_identities(&state, &search_text).await
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

#[tauri::command]
pub async fn list_iteration_paths(
    state: State<'_, AppState>,
    organization: String,
    project: String,
) -> Result<Vec<String>, String> {
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/classificationnodes/Iterations?$depth=10&api-version=7.1",
        organization, project
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Iteration paths request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Iteration paths").await?;
    let data: ClassificationNodeResponse = resp
        .json()
        .await
        .map_err(|e| format!("Iteration paths parse error: {e}"))?;

    let mut paths = Vec::new();
    flatten_area_paths(&data, "", &mut paths);
    Ok(paths)
}

#[tauri::command]
pub async fn search_project_tags(
    state: State<'_, AppState>,
    organization: String,
    project: String,
    search_text: String,
) -> Result<Vec<ProjectTag>, String> {
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/tags?api-version=7.1-preview.1",
        organization, project
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Project tags request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Project tags").await?;
    let data: ProjectTagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Project tags parse error: {e}"))?;

    let normalized_search_text = search_text.trim().to_lowercase();
    Ok(data
        .value
        .into_iter()
        .filter(|tag| tag.name.to_lowercase().contains(&normalized_search_text))
        .take(MAX_PROJECT_TAG_SEARCH_RESULTS)
        .collect())
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
