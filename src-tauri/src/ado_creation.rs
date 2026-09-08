use std::collections::{BTreeMap, HashMap, HashSet};

use sha2::{Digest, Sha256};
use tauri::State;

use crate::ado_api::{create_work_item_from_patch, patch_work_item};
use crate::ado_client::check_response;
use crate::ai_planner::{planner_validation_context, validate_plan};
use crate::audit_log::AuditAction;
use crate::models::{
    CreatedWorkItem, GeneratedWorkItem, JsonPatchOperation, SubmitWorkItemPlanRequest,
    SubmitWorkItemPlanResult, WorkItemTypeDefinition,
};
use crate::state::AppState;

const TITLE_FIELD: &str = "System.Title";
const DESCRIPTION_FIELD: &str = "System.Description";
const ACCEPTANCE_CRITERIA_FIELD: &str = "Microsoft.VSTS.Common.AcceptanceCriteria";
const STATE_FIELD: &str = "System.State";
const ITERATION_FIELD: &str = "System.IterationPath";
const AREA_FIELD: &str = "System.AreaPath";
const ASSIGNED_TO_FIELD: &str = "System.AssignedTo";
const TAGS_FIELD: &str = "System.Tags";
const SUBMISSION_TAG_PREFIX: &str = "DecentAdoBoardAI";

async fn fetch_supported_fields(
    state: &AppState,
    work_item_type: &str,
) -> Result<HashSet<String>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitemtypes/{}?api-version=7.1",
        config.organization,
        config.project,
        urlencoding::encode(work_item_type)
    );
    let response = state
        .http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch fields for '{work_item_type}': {error}"))?;
    let response =
        check_response(response, &format!("Fetch fields for '{work_item_type}'")).await?;
    let definition: WorkItemTypeDefinition = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse fields for '{work_item_type}': {error}"))?;
    Ok(definition
        .fields
        .into_iter()
        .map(|field| field.reference_name)
        .collect())
}

fn add_field(
    patch: &mut Vec<JsonPatchOperation>,
    supported_fields: &HashSet<String>,
    field: &str,
    value: String,
) {
    if supported_fields.contains(field) && !value.trim().is_empty() {
        patch.push(JsonPatchOperation {
            op: "add".to_string(),
            path: format!("/fields/{field}"),
            value: serde_json::Value::String(value),
        });
    }
}

fn create_patch(
    item: &GeneratedWorkItem,
    config: &crate::models::AdoConfig,
    supported_fields: &HashSet<String>,
    parent_ado_id: Option<i64>,
    submission_tag: &str,
) -> Vec<JsonPatchOperation> {
    let mut patch = Vec::new();
    add_field(
        &mut patch,
        supported_fields,
        TITLE_FIELD,
        item.title.clone(),
    );
    add_field(
        &mut patch,
        supported_fields,
        DESCRIPTION_FIELD,
        item.description.clone(),
    );
    add_field(
        &mut patch,
        supported_fields,
        ACCEPTANCE_CRITERIA_FIELD,
        item.acceptance_criteria.clone(),
    );
    add_field(
        &mut patch,
        supported_fields,
        STATE_FIELD,
        item.state.clone(),
    );
    add_field(
        &mut patch,
        supported_fields,
        ITERATION_FIELD,
        item.iteration_path.clone(),
    );
    add_field(
        &mut patch,
        supported_fields,
        AREA_FIELD,
        config.area_path.clone(),
    );
    add_field(
        &mut patch,
        supported_fields,
        ASSIGNED_TO_FIELD,
        item.assigned_to.clone(),
    );
    add_field(
        &mut patch,
        supported_fields,
        TAGS_FIELD,
        submission_tag.to_string(),
    );

    if let Some(parent_id) = parent_ado_id {
        patch.push(JsonPatchOperation {
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
    patch
}

async fn create_work_item(
    state: &AppState,
    item: &GeneratedWorkItem,
    supported_fields: &HashSet<String>,
    parent_ado_id: Option<i64>,
    submission_tag: &str,
) -> Result<i64, String> {
    let config = state.get_config()?;
    let patch = create_patch(
        item,
        &config,
        supported_fields,
        parent_ado_id,
        submission_tag,
    );
    let context = format!("Create '{}'", item.title);
    let ado_id = create_work_item_from_patch(state, &item.work_item_type, &patch, &context).await?;

    if let Err(error) = state.audit_log.log(
        AuditAction::Create {
            title: item.title.clone(),
            work_item_type: item.work_item_type.clone(),
            iteration: item.iteration_path.clone(),
        },
        ado_id,
    ) {
        eprintln!("Failed to write audit log for created work item {ado_id}: {error}");
    }
    Ok(ado_id)
}

fn submission_tag(submission_id: &str, temporary_id: &str) -> String {
    let digest = Sha256::digest(format!("{submission_id}\0{temporary_id}").as_bytes());
    let hash = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{SUBMISSION_TAG_PREFIX}-{hash}")
}

fn escape_wiql(value: &str) -> String {
    value.replace('\'', "''")
}

async fn find_work_item_by_submission_tag(
    state: &AppState,
    tag: &str,
) -> Result<Option<i64>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/wiql?api-version=7.1",
        config.organization, config.project
    );
    let query = format!(
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '{}'",
        escape_wiql(tag)
    );
    let response = state
        .http_client
        .post(url)
        .header("Authorization", auth)
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await
        .map_err(|error| format!("Failed to reconcile submission tag '{tag}': {error}"))?;
    let response = check_response(response, "Reconcile generated work item").await?;
    let body: crate::models::WiqlResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse reconciliation query: {error}"))?;
    let mut exact_matches = Vec::new();
    for work_item in body.work_items {
        if work_item_has_exact_tag(state, work_item.id, tag).await? {
            exact_matches.push(work_item.id);
        }
    }
    match exact_matches.as_slice() {
        [] => Ok(None),
        [work_item_id] => Ok(Some(*work_item_id)),
        _ => Err(format!(
            "Multiple ADO work items use the exact submission marker '{tag}'"
        )),
    }
}

async fn work_item_has_exact_tag(
    state: &AppState,
    work_item_id: i64,
    expected_tag: &str,
) -> Result<bool, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{work_item_id}?fields=System.Tags&api-version=7.1",
        config.organization, config.project
    );
    let response = state
        .http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|error| format!("Failed to verify submission tag on #{work_item_id}: {error}"))?;
    let response = check_response(response, "Verify generated work-item marker").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse tags for #{work_item_id}: {error}"))?;
    Ok(body["fields"][TAGS_FIELD]
        .as_str()
        .is_some_and(|tags| tags.split(';').any(|tag| tag.trim() == expected_tag)))
}

fn creation_order(items: &[GeneratedWorkItem]) -> Result<Vec<&GeneratedWorkItem>, String> {
    let mut ordered = Vec::with_capacity(items.len());
    let mut added = HashSet::new();
    while ordered.len() < items.len() {
        let before = ordered.len();
        for item in items {
            if added.contains(item.temporary_id.as_str()) {
                continue;
            }
            let parent_ready = item
                .parent_temporary_id
                .as_deref()
                .is_none_or(|parent_id| added.contains(parent_id));
            if parent_ready {
                added.insert(item.temporary_id.as_str());
                ordered.push(item);
            }
        }
        if ordered.len() == before {
            return Err("Unable to order work items by parent hierarchy".to_string());
        }
    }
    Ok(ordered)
}

async fn dependency_exists(
    state: &AppState,
    source_id: i64,
    target_id: i64,
) -> Result<bool, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{source_id}?$expand=relations&api-version=7.1",
        config.organization, config.project
    );
    let response = state
        .http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|error| format!("Failed to inspect dependencies for {source_id}: {error}"))?;
    let response = check_response(response, "Inspect work-item dependencies").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse dependencies for {source_id}: {error}"))?;
    let target_suffix = format!("/workItems/{target_id}");
    Ok(body["relations"].as_array().is_some_and(|relations| {
        relations.iter().any(|relation| {
            relation["rel"].as_str() == Some("System.LinkTypes.Dependency-Forward")
                && relation["url"]
                    .as_str()
                    .is_some_and(|url| url.ends_with(&target_suffix))
        })
    }))
}

async fn add_dependency_if_missing(
    state: &AppState,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    if dependency_exists(state, source_id, target_id).await? {
        return Ok(());
    }
    let config = state.get_config()?;
    let patch = vec![JsonPatchOperation {
        op: "add".to_string(),
        path: "/relations/-".to_string(),
        value: serde_json::json!({
            "rel": "System.LinkTypes.Dependency-Forward",
            "url": format!(
                "https://dev.azure.com/{}/_apis/wit/workItems/{target_id}",
                config.organization
            ),
        }),
    }];
    patch_work_item(state, source_id, &patch, "Add generated dependency").await?;
    state.audit_log.log(
        AuditAction::AddDependency {
            predecessor_id: source_id,
        },
        target_id,
    )?;
    Ok(())
}

fn failure_result(
    created_items: Vec<CreatedWorkItem>,
    ado_ids: BTreeMap<String, i64>,
    failed_temporary_id: Option<String>,
    error: String,
) -> SubmitWorkItemPlanResult {
    SubmitWorkItemPlanResult {
        created_items,
        ado_ids,
        failed_temporary_id,
        error: Some(error),
    }
}

async fn submit_plan_impl(
    state: &AppState,
    request: SubmitWorkItemPlanRequest,
) -> Result<SubmitWorkItemPlanResult, String> {
    if request.submission_id.trim().is_empty() {
        return Err("Submission ID is required".to_string());
    }
    let context = planner_validation_context(state).await?;
    validate_plan(&request.plan, &context)?;
    let mut submission_tags = HashSet::new();
    for item in &request.plan.items {
        let marker = submission_tag(&request.submission_id, &item.temporary_id);
        if !submission_tags.insert(marker) {
            return Err("Generated submission markers are not unique".to_string());
        }
    }
    let ordered_items = creation_order(&request.plan.items)?;
    let supplied_ado_ids = request.existing_ado_ids;
    let mut ado_ids = BTreeMap::new();
    let mut created_items = Vec::new();
    let mut fields_by_type = HashMap::<String, HashSet<String>>::new();

    for item in ordered_items {
        let parent_ado_id = match item.parent_temporary_id.as_deref() {
            Some(parent_id) => match ado_ids.get(parent_id).copied() {
                Some(ado_id) => Some(ado_id),
                None => {
                    return Ok(failure_result(
                        created_items,
                        ado_ids,
                        Some(item.temporary_id.clone()),
                        format!("Parent '{parent_id}' has no ADO ID"),
                    ));
                }
            },
            None => None,
        };
        if !fields_by_type.contains_key(&item.work_item_type) {
            match fetch_supported_fields(state, &item.work_item_type).await {
                Ok(fields) => {
                    fields_by_type.insert(item.work_item_type.clone(), fields);
                }
                Err(error) => {
                    return Ok(failure_result(
                        created_items,
                        ado_ids,
                        Some(item.temporary_id.clone()),
                        error,
                    ));
                }
            }
        }
        let supported_fields = &fields_by_type[&item.work_item_type];
        if !supported_fields.contains(TAGS_FIELD) {
            return Ok(failure_result(
                created_items,
                ado_ids,
                Some(item.temporary_id.clone()),
                format!(
                    "Work-item type '{}' does not support System.Tags, which is required for safe retry",
                    item.work_item_type
                ),
            ));
        }
        let marker = submission_tag(&request.submission_id, &item.temporary_id);
        match find_work_item_by_submission_tag(state, &marker).await {
            Ok(Some(ado_id)) => {
                if supplied_ado_ids
                    .get(&item.temporary_id)
                    .is_some_and(|supplied_id| *supplied_id != ado_id)
                {
                    return Ok(failure_result(
                        created_items,
                        ado_ids,
                        Some(item.temporary_id.clone()),
                        format!(
                            "ADO ID for '{}' does not match its submission marker",
                            item.temporary_id
                        ),
                    ));
                }
                ado_ids.insert(item.temporary_id.clone(), ado_id);
                continue;
            }
            Ok(None) => {
                if supplied_ado_ids.contains_key(&item.temporary_id) {
                    return Ok(failure_result(
                        created_items,
                        ado_ids,
                        Some(item.temporary_id.clone()),
                        format!(
                            "Stored ADO ID for '{}' could not be verified",
                            item.temporary_id
                        ),
                    ));
                }
            }
            Err(error) => {
                return Ok(failure_result(
                    created_items,
                    ado_ids,
                    Some(item.temporary_id.clone()),
                    error,
                ));
            }
        }
        match create_work_item(state, item, supported_fields, parent_ado_id, &marker).await {
            Ok(ado_id) => {
                ado_ids.insert(item.temporary_id.clone(), ado_id);
                created_items.push(CreatedWorkItem {
                    temporary_id: item.temporary_id.clone(),
                    ado_id,
                    title: item.title.clone(),
                });
            }
            Err(error) => {
                if let Ok(Some(ado_id)) = find_work_item_by_submission_tag(state, &marker).await {
                    ado_ids.insert(item.temporary_id.clone(), ado_id);
                    created_items.push(CreatedWorkItem {
                        temporary_id: item.temporary_id.clone(),
                        ado_id,
                        title: item.title.clone(),
                    });
                    continue;
                }
                return Ok(failure_result(
                    created_items,
                    ado_ids,
                    Some(item.temporary_id.clone()),
                    error,
                ));
            }
        }
    }

    for item in &request.plan.items {
        let Some(target_id) = ado_ids.get(&item.temporary_id).copied() else {
            return Ok(failure_result(
                created_items,
                ado_ids,
                Some(item.temporary_id.clone()),
                "Created work item has no mapped ADO ID".to_string(),
            ));
        };
        for predecessor_temporary_id in &item.dependency_temporary_ids {
            let Some(source_id) = ado_ids.get(predecessor_temporary_id).copied() else {
                return Ok(failure_result(
                    created_items,
                    ado_ids,
                    Some(item.temporary_id.clone()),
                    format!("Dependency '{predecessor_temporary_id}' has no ADO ID"),
                ));
            };
            if let Err(error) = add_dependency_if_missing(state, source_id, target_id).await {
                return Ok(failure_result(
                    created_items,
                    ado_ids,
                    Some(item.temporary_id.clone()),
                    error,
                ));
            }
        }
    }

    Ok(SubmitWorkItemPlanResult {
        created_items,
        ado_ids,
        failed_temporary_id: None,
        error: None,
    })
}

#[tauri::command]
pub async fn submit_work_item_plan(
    state: State<'_, AppState>,
    request: SubmitWorkItemPlanRequest,
) -> Result<SubmitWorkItemPlanResult, String> {
    submit_plan_impl(&state, request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, parent_id: Option<&str>) -> GeneratedWorkItem {
        GeneratedWorkItem {
            temporary_id: id.to_string(),
            parent_temporary_id: parent_id.map(str::to_string),
            work_item_type: "Task".to_string(),
            state: "Proposed".to_string(),
            title: id.to_string(),
            description: String::new(),
            acceptance_criteria: String::new(),
            iteration_path: "Project\\Current".to_string(),
            assigned_to: "user@example.com".to_string(),
            dependency_temporary_ids: Vec::new(),
        }
    }

    #[test]
    fn orders_parents_before_children() {
        let items = vec![
            item("grandchild", Some("child")),
            item("root", None),
            item("child", Some("root")),
        ];
        let ordered_ids: Vec<_> = creation_order(&items)
            .unwrap()
            .into_iter()
            .map(|work_item| work_item.temporary_id.as_str())
            .collect();
        assert_eq!(ordered_ids, vec!["root", "child", "grandchild"]);
    }

    #[test]
    fn create_patch_omits_unsupported_optional_fields() {
        let work_item = item("task", None);
        let config = crate::models::AdoConfig {
            organization: "org".to_string(),
            project: "project".to_string(),
            area_path: "Project\\Area".to_string(),
        };
        let supported_fields = HashSet::from([
            TITLE_FIELD.to_string(),
            STATE_FIELD.to_string(),
            ITERATION_FIELD.to_string(),
            AREA_FIELD.to_string(),
        ]);
        let patch = create_patch(
            &work_item,
            &config,
            &supported_fields,
            None,
            "submission-tag",
        );
        assert!(patch
            .iter()
            .all(|operation| operation.path != format!("/fields/{DESCRIPTION_FIELD}")));
        assert!(patch
            .iter()
            .any(|operation| operation.path == format!("/fields/{TITLE_FIELD}")));
    }

    #[test]
    fn submission_tag_is_stable_and_collision_resistant() {
        assert_eq!(
            submission_tag("submission", "task/one"),
            submission_tag("submission", "task/one")
        );
        assert_ne!(
            submission_tag("submission", "task/one"),
            submission_tag("submission", "task-one")
        );
        assert_ne!(
            submission_tag("submission", "task"),
            submission_tag("submission", "task-1")
        );
    }

    #[test]
    fn create_patch_adds_submission_tag() {
        let work_item = item("task", None);
        let config = crate::models::AdoConfig {
            organization: "org".to_string(),
            project: "project".to_string(),
            area_path: "Project\\Area".to_string(),
        };
        let supported_fields = HashSet::from([TITLE_FIELD.to_string(), TAGS_FIELD.to_string()]);
        let patch = create_patch(
            &work_item,
            &config,
            &supported_fields,
            None,
            "DecentAdoBoardAI-submission-task",
        );
        assert!(patch.iter().any(|operation| {
            operation.path == format!("/fields/{TAGS_FIELD}")
                && operation.value == "DecentAdoBoardAI-submission-task"
        }));
    }
}
