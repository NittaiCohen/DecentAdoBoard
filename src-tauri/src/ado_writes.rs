use tauri::State;

use crate::ado_client::check_response;
use crate::audit_log::AuditAction;
use crate::models::{
    AdoWorkItemTypeState, JsonPatchOperation, WorkItemFieldUpdate, WorkItemTypeStatesResponse,
};
use crate::state::AppState;

/// Fetch the current state of a work item from ADO.
async fn fetch_current_state(state: &AppState, work_item_id: i64) -> Result<String, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?$select=System.State&api-version=7.1",
        config.organization, config.project, work_item_id
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch work item state: {e}"))?;

    let resp = check_response(resp, "Fetch work item state").await?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse work item response: {e}"))?;

    body["fields"]["System.State"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Work item has no System.State field".to_string())
}

/// Fetch the current iteration path of a work item from ADO.
async fn fetch_current_iteration(state: &AppState, work_item_id: i64) -> Result<String, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?$select=System.IterationPath&api-version=7.1",
        config.organization, config.project, work_item_id
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch work item iteration: {e}"))?;

    let resp = check_response(resp, "Fetch work item iteration").await?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse work item response: {e}"))?;

    body["fields"]["System.IterationPath"]
        .as_str()
        .map(|path| path.to_string())
        .ok_or_else(|| "Work item has no System.IterationPath field".to_string())
}

/// Update a work item's state via the ADO PATCH API and log to the audit log.
async fn update_state_impl(
    state: &AppState,
    work_item_id: i64,
    new_state: &str,
) -> Result<(), String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    // Fetch current state from ADO for accurate audit logging
    let old_state = fetch_current_state(state, work_item_id).await?;

    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?api-version=7.1",
        config.organization, config.project, work_item_id
    );

    let patch_body = vec![JsonPatchOperation {
        op: "replace".to_string(),
        path: "/fields/System.State".to_string(),
        value: serde_json::Value::String(new_state.to_string()),
    }];

    let resp = state
        .http_client
        .patch(&url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json-patch+json")
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| format!("Failed to update work item state: {e}"))?;

    check_response(resp, "Update work item state").await?;

    // Log to audit log after successful update
    state.audit_log.log(
        AuditAction::UpdateState {
            old: old_state,
            new: new_state.to_string(),
        },
        work_item_id,
    )?;

    Ok(())
}

/// Update a work item's iteration path via the ADO PATCH API and log the change.
async fn update_iteration_impl(
    state: &AppState,
    work_item_id: i64,
    new_iteration_path: &str,
) -> Result<(), String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let old_iteration_path = fetch_current_iteration(state, work_item_id).await?;

    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?api-version=7.1",
        config.organization, config.project, work_item_id
    );

    let patch_body = vec![JsonPatchOperation {
        op: "replace".to_string(),
        path: "/fields/System.IterationPath".to_string(),
        value: serde_json::Value::String(new_iteration_path.to_string()),
    }];

    let resp = state
        .http_client
        .patch(&url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json-patch+json")
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| format!("Failed to update work item iteration: {e}"))?;

    check_response(resp, "Update work item iteration").await?;

    state.audit_log.log(
        AuditAction::UpdateIteration {
            old: old_iteration_path,
            new: new_iteration_path.to_string(),
        },
        work_item_id,
    )?;

    Ok(())
}

/// Fetch valid states for a work item type from the ADO API.
async fn fetch_states_impl(
    state: &AppState,
    work_item_type: &str,
) -> Result<Vec<AdoWorkItemTypeState>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitemtypes/{}/states?api-version=7.1",
        config.organization,
        config.project,
        urlencoding_path(work_item_type)
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch work item type states: {e}"))?;

    let resp = check_response(resp, &format!("Fetch states for '{work_item_type}'")).await?;

    let body: WorkItemTypeStatesResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse work item type states: {e}"))?;

    Ok(body.value)
}

/// Percent-encode a path segment for use in URLs.
fn urlencoding_path(value: &str) -> String {
    value.replace(' ', "%20").replace('/', "%2F")
}

fn escape_json_pointer_segment(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

async fn update_fields_impl(
    state: &AppState,
    work_item_id: i64,
    updates: &[WorkItemFieldUpdate],
) -> Result<(), String> {
    if updates.is_empty() {
        return Err("At least one work item field update is required".to_string());
    }

    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?api-version=7.1",
        config.organization, config.project, work_item_id
    );
    let patch_body: Vec<JsonPatchOperation> = updates
        .iter()
        .map(|update| JsonPatchOperation {
            op: "replace".to_string(),
            path: format!(
                "/fields/{}",
                escape_json_pointer_segment(&update.reference_name)
            ),
            value: update.value.clone(),
        })
        .collect();

    let response = state
        .http_client
        .patch(&url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json-patch+json")
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| format!("Failed to update work item fields: {e}"))?;

    check_response(response, "Update work item fields").await?;
    Ok(())
}

// --- Tauri commands ---

#[tauri::command]
pub async fn update_work_item_state(
    state: State<'_, AppState>,
    work_item_id: i64,
    new_state: String,
) -> Result<(), String> {
    update_state_impl(&state, work_item_id, &new_state).await
}

#[tauri::command]
pub async fn update_work_item_iteration(
    state: State<'_, AppState>,
    work_item_id: i64,
    new_iteration_path: String,
) -> Result<(), String> {
    update_iteration_impl(&state, work_item_id, &new_iteration_path).await
}

#[tauri::command]
pub async fn update_work_item_fields(
    state: State<'_, AppState>,
    work_item_id: i64,
    updates: Vec<WorkItemFieldUpdate>,
) -> Result<(), String> {
    update_fields_impl(&state, work_item_id, &updates).await
}

#[tauri::command]
pub async fn create_work_item(
    state: State<'_, AppState>,
    work_item_type: String,
    title: String,
    description: Option<String>,
    iteration_path: Option<String>,
    additional_fields: Option<Vec<WorkItemFieldUpdate>>,
) -> Result<i64, String> {
    if title.trim().is_empty() {
        return Err("A work item title is required".to_string());
    }

    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/${}?api-version=7.1",
        config.organization,
        config.project,
        urlencoding_path(&work_item_type)
    );

    let mut patch_body = vec![JsonPatchOperation {
        op: "add".to_string(),
        path: "/fields/System.Title".to_string(),
        value: serde_json::Value::String(title.trim().to_string()),
    }];
    if let Some(description) = description.filter(|value| !value.trim().is_empty()) {
        patch_body.push(JsonPatchOperation {
            op: "add".to_string(),
            path: "/fields/System.Description".to_string(),
            value: serde_json::Value::String(description),
        });
    }
    if let Some(iteration_path) = iteration_path.filter(|value| !value.trim().is_empty()) {
        patch_body.push(JsonPatchOperation {
            op: "add".to_string(),
            path: "/fields/System.IterationPath".to_string(),
            value: serde_json::Value::String(iteration_path),
        });
    }
    if let Some(additional_fields) = additional_fields {
        for field in additional_fields {
            if matches!(
                field.reference_name.as_str(),
                "System.Title" | "System.Description" | "System.IterationPath"
            ) {
                continue;
            }
            if field.value.is_null()
                || field
                    .value
                    .as_str()
                    .is_some_and(|value| value.trim().is_empty())
            {
                continue;
            }
            patch_body.push(JsonPatchOperation {
                op: "add".to_string(),
                path: format!("/fields/{}", field.reference_name),
                value: field.value,
            });
        }
    }

    let response = state
        .http_client
        .post(&url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json-patch+json")
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| format!("Create work item request failed: {e}"))?;
    let response = check_response(response, "Create work item").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Create work item response parse error: {e}"))?;

    body["id"]
        .as_i64()
        .ok_or_else(|| "Create work item response did not contain an id".to_string())
}

#[tauri::command]
pub async fn get_work_item_type_states(
    state: State<'_, AppState>,
    work_item_type: String,
) -> Result<Vec<AdoWorkItemTypeState>, String> {
    fetch_states_impl(&state, &work_item_type).await
}

/// Add a predecessor/successor dependency between two work items in ADO.
/// Creates a Dependency-Forward relation from source_id to target_id,
/// meaning source_id is a predecessor of target_id.
async fn add_dependency_impl(
    state: &AppState,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?api-version=7.1",
        config.organization, config.project, source_id
    );

    let relation_url = format!(
        "https://dev.azure.com/{}/_apis/wit/workItems/{}",
        config.organization, target_id
    );

    let patch_body = vec![JsonPatchOperation {
        op: "add".to_string(),
        path: "/relations/-".to_string(),
        value: serde_json::json!({
            "rel": "System.LinkTypes.Dependency-Forward",
            "url": relation_url,
        }),
    }];

    let resp = state
        .http_client
        .patch(&url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json-patch+json")
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| format!("Failed to add dependency: {e}"))?;

    check_response(resp, "Add dependency").await?;

    state.audit_log.log(
        AuditAction::AddDependency {
            predecessor_id: source_id,
        },
        target_id,
    )?;

    Ok(())
}

#[tauri::command]
pub async fn add_dependency(
    state: State<'_, AppState>,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    add_dependency_impl(&state, source_id, target_id).await
}

/// Remove a predecessor/successor dependency between two work items in ADO.
/// Finds the Dependency-Forward relation from source_id to target_id and removes it.
async fn remove_dependency_impl(
    state: &AppState,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    // Fetch the source work item with relations to find the relation index
    let get_url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?$expand=relations&api-version=7.1",
        config.organization, config.project, source_id
    );

    let resp = state
        .http_client
        .get(&get_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch work item relations: {e}"))?;

    let resp = check_response(resp, "Fetch work item relations").await?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse work item response: {e}"))?;

    let relations = body["relations"]
        .as_array()
        .ok_or_else(|| format!("Work item {source_id} has no relations"))?;

    let target_suffix = format!("/workItems/{target_id}");
    let relation_index = relations
        .iter()
        .position(|rel| {
            rel["rel"].as_str() == Some("System.LinkTypes.Dependency-Forward")
                && rel["url"]
                    .as_str()
                    .is_some_and(|url| url.ends_with(&target_suffix))
        })
        .ok_or_else(|| {
            format!("No Dependency-Forward relation found from {source_id} to {target_id}")
        })?;

    // PATCH to remove the relation by index
    let patch_url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?api-version=7.1",
        config.organization, config.project, source_id
    );

    let patch_body = vec![JsonPatchOperation {
        op: "remove".to_string(),
        path: format!("/relations/{relation_index}"),
        value: serde_json::Value::Null,
    }];

    let resp = state
        .http_client
        .patch(&patch_url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json-patch+json")
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| format!("Failed to remove dependency: {e}"))?;

    check_response(resp, "Remove dependency").await?;

    state.audit_log.log(
        AuditAction::RemoveDependency {
            predecessor_id: source_id,
        },
        target_id,
    )?;

    Ok(())
}

#[tauri::command]
pub async fn remove_dependency(
    state: State<'_, AppState>,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    remove_dependency_impl(&state, source_id, target_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencoding_path_encodes_spaces() {
        assert_eq!(urlencoding_path("User Story"), "User%20Story");
    }

    #[test]
    fn urlencoding_path_encodes_slashes() {
        assert_eq!(urlencoding_path("a/b"), "a%2Fb");
    }

    #[test]
    fn urlencoding_path_plain_text_unchanged() {
        assert_eq!(urlencoding_path("Task"), "Task");
    }

    #[test]
    fn urlencoding_path_product_backlog_item() {
        assert_eq!(
            urlencoding_path("Product Backlog Item"),
            "Product%20Backlog%20Item"
        );
    }
}
