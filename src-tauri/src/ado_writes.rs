use tauri::State;

use crate::ado_api::{create_work_item_from_patch, fetch_work_item_field_text, patch_work_item};
use crate::ado_client::{check_response, fetch_work_item_type_states};
use crate::audit_log::AuditAction;
use crate::models::{AdoWorkItemTypeState, JsonPatchOperation, WorkItemFieldUpdate};
use crate::state::AppState;

/// Fetch the current state of a work item from ADO.
async fn fetch_current_state(state: &AppState, work_item_id: i64) -> Result<String, String> {
    fetch_work_item_field_text(state, work_item_id, "System.State", "Fetch work item state").await
}

/// Fetch the current iteration path of a work item from ADO.
async fn fetch_current_iteration(state: &AppState, work_item_id: i64) -> Result<String, String> {
    fetch_work_item_field_text(
        state,
        work_item_id,
        "System.IterationPath",
        "Fetch work item iteration",
    )
    .await
}

/// Update a work item's state via the ADO PATCH API and log to the audit log.
async fn update_state_impl(
    state: &AppState,
    work_item_id: i64,
    new_state: &str,
) -> Result<(), String> {
    // Fetch current state from ADO for accurate audit logging
    let old_state = fetch_current_state(state, work_item_id).await?;

    let patch_body = vec![JsonPatchOperation {
        op: "replace".to_string(),
        path: "/fields/System.State".to_string(),
        value: serde_json::Value::String(new_state.to_string()),
    }];

    patch_work_item(state, work_item_id, &patch_body, "Update work item state").await?;

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
    let old_iteration_path = fetch_current_iteration(state, work_item_id).await?;

    let patch_body = vec![JsonPatchOperation {
        op: "replace".to_string(),
        path: "/fields/System.IterationPath".to_string(),
        value: serde_json::Value::String(new_iteration_path.to_string()),
    }];

    patch_work_item(
        state,
        work_item_id,
        &patch_body,
        "Update work item iteration",
    )
    .await?;

    state.audit_log.log(
        AuditAction::UpdateIteration {
            old: old_iteration_path,
            new: new_iteration_path.to_string(),
        },
        work_item_id,
    )?;

    Ok(())
}

fn escape_json_pointer_segment(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn create_field_update_patch(updates: &[WorkItemFieldUpdate]) -> Vec<JsonPatchOperation> {
    updates
        .iter()
        .map(|update| JsonPatchOperation {
            // ADO accepts `add` for both absent and existing fields. `replace` fails when an
            // optional field such as Description has never been set on the work item.
            op: "add".to_string(),
            path: format!(
                "/fields/{}",
                escape_json_pointer_segment(&update.reference_name)
            ),
            value: update.value.clone(),
        })
        .collect()
}

async fn update_fields_impl(
    state: &AppState,
    work_item_id: i64,
    updates: &[WorkItemFieldUpdate],
) -> Result<(), String> {
    if updates.is_empty() {
        return Err("At least one work item field update is required".to_string());
    }

    let patch_body = create_field_update_patch(updates);
    patch_work_item(state, work_item_id, &patch_body, "Update work item fields").await?;
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
    parent_work_item_id: Option<i64>,
) -> Result<i64, String> {
    if title.trim().is_empty() {
        return Err("A work item title is required".to_string());
    }

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

    if let Some(parent_id) = parent_work_item_id {
        let config = state.get_config()?;
        patch_body.push(JsonPatchOperation {
            op: "add".to_string(),
            path: "/relations/-".to_string(),
            value: serde_json::json!({
                "rel": "System.LinkTypes.Hierarchy-Reverse",
                "url": format!(
                    "https://dev.azure.com/{}/_apis/wit/workItems/{parent_id}",
                    config.organization
                ),
            }),
        });
    }

    create_work_item_from_patch(&state, &work_item_type, &patch_body, "Create work item").await
}

#[tauri::command]
pub async fn get_work_item_type_states(
    state: State<'_, AppState>,
    work_item_type: String,
) -> Result<Vec<AdoWorkItemTypeState>, String> {
    fetch_work_item_type_states(&state, &work_item_type).await
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

    patch_work_item(state, source_id, &patch_body, "Add dependency").await?;

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
    let patch_body = vec![JsonPatchOperation {
        op: "remove".to_string(),
        path: format!("/relations/{relation_index}"),
        value: serde_json::Value::Null,
    }];

    patch_work_item(state, source_id, &patch_body, "Remove dependency").await?;

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
    fn field_updates_use_add_for_absent_and_existing_fields() {
        let patch = create_field_update_patch(&[WorkItemFieldUpdate {
            reference_name: "Custom.Field/Name".to_string(),
            value: serde_json::Value::String("value".to_string()),
        }]);

        assert_eq!(patch[0].op, "add");
        assert_eq!(patch[0].path, "/fields/Custom.Field~1Name");
    }
}
