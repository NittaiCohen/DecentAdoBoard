use std::collections::{HashMap, HashSet};

use tauri::State;

use crate::ado_client::{check_response, fetch_iterations};
use crate::auth::get_az_cli_resource_access_token;
use crate::foundry_local;
use crate::models::{
    AdoWorkItemTypeState, AiPlannerContext, AiWorkItemTypeMetadata, GenerateWorkItemPlanRequest,
    GeneratedWorkItemPlan, WorkItemTypeStatesResponse, WorkItemTypesResponse,
};
use crate::state::AppState;

const AZURE_OPENAI_ENDPOINT_ENV: &str = "DECENT_ADO_BOARD_AZURE_OPENAI_ENDPOINT";
const AZURE_OPENAI_DEPLOYMENT_ENV: &str = "DECENT_ADO_BOARD_AZURE_OPENAI_DEPLOYMENT";
const AZURE_OPENAI_API_VERSION_ENV: &str = "DECENT_ADO_BOARD_AZURE_OPENAI_API_VERSION";
const DEFAULT_AZURE_OPENAI_API_VERSION: &str = "2024-10-21";
const AZURE_OPENAI_RESOURCE: &str = "https://cognitiveservices.azure.com/";
const AI_PROVIDER_ENV: &str = "DECENT_ADO_BOARD_AI_PROVIDER";
const PROPOSED_STATE_CATEGORY: &str = "Proposed";

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum AiProvider {
    AzureOpenAi,
    FoundryLocal,
}

impl AiProvider {
    fn as_label(self) -> &'static str {
        match self {
            AiProvider::AzureOpenAi => "azureOpenAi",
            AiProvider::FoundryLocal => "foundryLocal",
        }
    }
}

#[derive(Debug)]
struct AzureOpenAiConfig {
    endpoint: String,
    deployment: String,
    api_version: String,
}

fn read_non_empty_environment_variable(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Environment variable {name} is not configured"))
}

fn azure_openai_config() -> Result<AzureOpenAiConfig, String> {
    Ok(AzureOpenAiConfig {
        endpoint: read_non_empty_environment_variable(AZURE_OPENAI_ENDPOINT_ENV)?
            .trim_end_matches('/')
            .to_string(),
        deployment: read_non_empty_environment_variable(AZURE_OPENAI_DEPLOYMENT_ENV)?,
        api_version: std::env::var(AZURE_OPENAI_API_VERSION_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_AZURE_OPENAI_API_VERSION.to_string()),
    })
}

async fn fetch_work_item_states(
    state: &AppState,
    work_item_type: &str,
) -> Result<Vec<AdoWorkItemTypeState>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let encoded_type = urlencoding::encode(work_item_type);
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitemtypes/{}/states?api-version=7.1",
        config.organization, config.project, encoded_type
    );

    let response = state
        .http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch states for '{work_item_type}': {error}"))?;
    let response =
        check_response(response, &format!("Fetch states for '{work_item_type}'")).await?;
    let body: WorkItemTypeStatesResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse states for '{work_item_type}': {error}"))?;
    Ok(body.value)
}

async fn fetch_work_item_type_metadata(
    state: &AppState,
) -> Result<Vec<AiWorkItemTypeMetadata>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitemtypes?api-version=7.1",
        config.organization, config.project
    );
    let response = state
        .http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch work-item types: {error}"))?;
    let response = check_response(response, "Fetch work-item types").await?;
    let body: WorkItemTypesResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse work-item types: {error}"))?;

    let mut result = Vec::new();
    for work_item_type in body.value {
        if work_item_type.is_disabled {
            continue;
        }
        let states = fetch_work_item_states(state, &work_item_type.name).await?;
        if states.is_empty() {
            continue;
        }
        let initial_state = states
            .iter()
            .find(|state| state.category.eq_ignore_ascii_case(PROPOSED_STATE_CATEGORY))
            .unwrap_or(&states[0])
            .name
            .clone();
        result.push(AiWorkItemTypeMetadata {
            name: work_item_type.name,
            initial_state,
            states: states.into_iter().map(|state| state.name).collect(),
        });
    }
    Ok(result)
}

fn current_iteration_path(iterations: &[crate::models::Iteration]) -> Option<String> {
    let now = chrono::Utc::now().to_rfc3339();
    iterations
        .iter()
        .find(|iteration| {
            iteration
                .start_date
                .as_deref()
                .is_some_and(|start| start <= now.as_str())
                && iteration
                    .finish_date
                    .as_deref()
                    .is_some_and(|finish| now.as_str() <= finish)
        })
        .or_else(|| {
            iterations
                .iter()
                .filter(|iteration| {
                    iteration
                        .start_date
                        .as_deref()
                        .is_some_and(|start| start > now.as_str())
                })
                .min_by_key(|iteration| iteration.start_date.as_deref())
        })
        .or_else(|| {
            iterations
                .iter()
                .filter(|iteration| {
                    iteration
                        .finish_date
                        .as_deref()
                        .is_some_and(|finish| finish < now.as_str())
                })
                .max_by_key(|iteration| iteration.finish_date.as_deref())
        })
        .or_else(|| iterations.first())
        .map(|iteration| iteration.path.clone())
}

async fn fetch_authenticated_identity(state: &AppState) -> Result<String, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1",
        config.organization
    );
    let response = state
        .http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch authenticated ADO identity: {error}"))?;
    let response = check_response(response, "Fetch authenticated ADO identity").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse authenticated ADO identity: {error}"))?;

    body["authenticatedUser"]["customDisplayName"]
        .as_str()
        .or_else(|| body["authenticatedUser"]["providerDisplayName"].as_str())
        .or_else(|| body["authenticatedUser"]["properties"]["Account"]["$value"].as_str())
        .map(str::to_string)
        .ok_or_else(|| "ADO did not return an authenticated user identity".to_string())
}

/// A backend that has already been resolved, carrying everything the transport needs so that
/// discovery (which spawns a process and makes an HTTP call) happens exactly once per request.
pub(crate) enum ResolvedAiBackend {
    AzureOpenAi,
    FoundryLocal(foundry_local::FoundryLocalConfig),
}

impl ResolvedAiBackend {
    fn provider(&self) -> AiProvider {
        match self {
            ResolvedAiBackend::AzureOpenAi => AiProvider::AzureOpenAi,
            ResolvedAiBackend::FoundryLocal(_) => AiProvider::FoundryLocal,
        }
    }
}

/// Resolves which backend to use. An explicit override wins; otherwise the cloud deployment is
/// preferred for plan quality and Foundry Local is used as the no-approval fallback.
async fn resolve_ai_backend(http_client: &reqwest::Client) -> Result<ResolvedAiBackend, String> {
    let requested = std::env::var(AI_PROVIDER_ENV)
        .ok()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());

    match requested.as_deref() {
        Some("azure-openai") => azure_openai_config().map(|_| ResolvedAiBackend::AzureOpenAi),
        Some("foundry-local") => foundry_local::resolve_config(http_client)
            .await
            .map(ResolvedAiBackend::FoundryLocal),
        Some(other) => Err(format!(
            "Unknown {AI_PROVIDER_ENV} value '{other}'. Use 'azure-openai' or 'foundry-local'."
        )),
        None => {
            if azure_openai_config().is_ok() {
                return Ok(ResolvedAiBackend::AzureOpenAi);
            }
            match foundry_local::resolve_config(http_client).await {
                Ok(config) => Ok(ResolvedAiBackend::FoundryLocal(config)),
                Err(foundry_error) => Err(format!(
                    "No AI backend is available. Azure OpenAI is not configured, and Foundry Local could not be used: {foundry_error}"
                )),
            }
        }
    }
}

/// Fetches only the ADO metadata the planner needs. Backend resolution is deliberately
/// excluded so that paths which merely validate a plan never touch the AI runtime.
async fn planner_metadata(state: &AppState) -> Result<AiPlannerContext, String> {
    let work_item_types = fetch_work_item_type_metadata(state).await?;
    let iterations = fetch_iterations(state).await?;
    let current_iteration_path = current_iteration_path(&iterations);
    let assigned_to = fetch_authenticated_identity(state).await?;

    Ok(AiPlannerContext {
        work_item_types,
        iterations,
        current_iteration_path,
        assigned_to,
        ai_provider: None,
        ai_ready: false,
        ai_error: None,
    })
}

/// Builds the planner context and returns the backend resolved alongside it, so callers that
/// need both never resolve twice and can never report one backend while using another.
async fn planner_context_with_backend(
    state: &AppState,
) -> Result<(AiPlannerContext, Result<ResolvedAiBackend, String>), String> {
    let mut context = planner_metadata(state).await?;
    let backend = resolve_ai_backend(&state.http_client).await;

    context.ai_provider = backend
        .as_ref()
        .ok()
        .map(|backend| backend.provider().as_label().to_string());
    context.ai_ready = backend.is_ok();
    context.ai_error = backend.as_ref().err().cloned();
    Ok((context, backend))
}

/// Metadata used to validate an already-generated plan. This intentionally reports no AI
/// backend, because validation does not need one.
pub(crate) async fn planner_validation_context(
    state: &AppState,
) -> Result<AiPlannerContext, String> {
    planner_metadata(state).await
}

pub(crate) async fn planner_context(state: &AppState) -> Result<AiPlannerContext, String> {
    planner_context_with_backend(state)
        .await
        .map(|(context, _)| context)
}

fn planner_system_prompt(context: &AiPlannerContext) -> Result<String, String> {
    let metadata = serde_json::to_string(&serde_json::json!({
        "workItemTypes": context.work_item_types,
        "iterations": context.iterations,
        "currentIterationPath": context.current_iteration_path,
        "assignedTo": context.assigned_to,
    }))
    .map_err(|error| format!("Failed to serialize ADO metadata: {error}"))?;
    Ok(format!(
        r#"You are an Azure DevOps work-item planning assistant.
Return one JSON object and no markdown. The object must have:
{{"mission":"string","items":[{{"temporaryId":"unique string","parentTemporaryId":"string or null","type":"valid ADO type","state":"valid state for that type","title":"non-empty string","description":"string","acceptanceCriteria":"string","iterationPath":"valid iteration path","assignedTo":"identity","dependencyTemporaryIds":["temporary IDs of predecessors"]}}]}}

Use only work-item types, states, and iteration paths from this ADO metadata:
{metadata}

Rules:
- Every field is required. Never return null except for parentTemporaryId when an item has no parent.
- Use an empty string for an unknown description or acceptanceCriteria.
- Use an empty array for dependencyTemporaryIds when there are no dependencies.
- Use the initialState for each type unless the user explicitly requests another valid state.
- Use currentIterationPath unless the user explicitly requests another listed iteration.
- Use assignedTo for generated items unless the user explicitly requests otherwise.
- Parent and dependency references must point to temporaryId values in the same response.
- Do not create hierarchy cycles or dependency cycles.
- Produce a practical hierarchy with implementation tasks, not a prose explanation."#
    ))
}

fn planner_user_prompt(request: &GenerateWorkItemPlanRequest) -> Result<String, String> {
    let mut prompt = format!("Mission:\n{}", request.mission.trim());
    if let Some(current_plan) = &request.current_plan {
        let serialized = serde_json::to_string(current_plan)
            .map_err(|error| format!("Failed to serialize current plan: {error}"))?;
        prompt.push_str("\n\nCurrent plan to revise:\n");
        prompt.push_str(&serialized);
    }
    if let Some(refinement) = request
        .refinement_request
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        prompt.push_str("\n\nRequested changes:\n");
        prompt.push_str(refinement);
    }
    Ok(prompt)
}

fn extract_json_content(content: &str) -> &str {
    let trimmed = content.trim();
    trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed)
}

async fn request_azure_openai_completion(
    state: &AppState,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let config = azure_openai_config()?;
    let access_token = get_az_cli_resource_access_token(AZURE_OPENAI_RESOURCE).await?;
    let url = format!(
        "{}/openai/deployments/{}/chat/completions?api-version={}",
        config.endpoint,
        urlencoding::encode(&config.deployment),
        urlencoding::encode(&config.api_version)
    );
    let body = serde_json::json!({
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    });
    let response = state
        .http_client
        .post(url)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Azure OpenAI request failed: {error}"))?;
    let response = check_response(response, "Azure OpenAI generation").await?;
    let response_body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse Azure OpenAI response: {error}"))?;
    response_body["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "Azure OpenAI returned no message content".to_string())
}

/// Prompt construction, JSON extraction, and validation are shared by every backend so the
/// provider only supplies transport.
async fn request_completion(
    state: &AppState,
    backend: &ResolvedAiBackend,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    match backend {
        ResolvedAiBackend::AzureOpenAi => {
            request_azure_openai_completion(state, system_prompt, user_prompt).await
        }
        ResolvedAiBackend::FoundryLocal(config) => {
            foundry_local::generate_chat_completion(
                &state.http_client,
                config,
                system_prompt,
                user_prompt,
            )
            .await
        }
    }
}

/// Asks the model to fix its own malformed output. Small on-device models frequently add prose
/// or truncate JSON, and a single corrective attempt recovers most of those cases without
/// making the user retype the mission.
fn repair_prompt(previous_response: &str, validation_error: &str) -> String {
    format!(
        "Your previous response could not be accepted as the required work-item plan.\n\
         Error: {validation_error}\n\n\
         Previous response:\n{previous_response}\n\n\
         Reply with the corrected JSON object only. Do not include explanations, \
         markdown fences, or any text outside the JSON."
    )
}

fn replace_null_with_string(
    object: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    default: &str,
) {
    if object.get(key).is_none_or(serde_json::Value::is_null) {
        object.insert(
            key.to_string(),
            serde_json::Value::String(default.to_string()),
        );
    }
}

fn normalize_plan_value(
    value: &mut serde_json::Value,
    context: &AiPlannerContext,
    request: &GenerateWorkItemPlanRequest,
) {
    let Some(plan) = value.as_object_mut() else {
        return;
    };
    replace_null_with_string(plan, "mission", request.mission.trim());

    let Some(items) = plan
        .get_mut("items")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    for item in items {
        let Some(item) = item.as_object_mut() else {
            continue;
        };
        replace_null_with_string(item, "description", "");
        replace_null_with_string(item, "acceptanceCriteria", "");
        replace_null_with_string(item, "assignedTo", &context.assigned_to);

        let work_item_metadata = item
            .get("type")
            .and_then(serde_json::Value::as_str)
            .and_then(|work_item_type| {
                context
                    .work_item_types
                    .iter()
                    .find(|metadata| metadata.name.eq_ignore_ascii_case(work_item_type))
            });
        if let Some(metadata) = work_item_metadata {
            item.insert(
                "type".to_string(),
                serde_json::Value::String(metadata.name.clone()),
            );
            let normalized_state = item
                .get("state")
                .and_then(serde_json::Value::as_str)
                .and_then(|state| {
                    metadata
                        .states
                        .iter()
                        .find(|valid_state| valid_state.eq_ignore_ascii_case(state))
                })
                .cloned()
                .unwrap_or_else(|| metadata.initial_state.clone());
            item.insert(
                "state".to_string(),
                serde_json::Value::String(normalized_state),
            );
        }

        let generated_iteration = item
            .get("iterationPath")
            .and_then(serde_json::Value::as_str);
        let normalized_iteration = generated_iteration
            .and_then(|iteration| {
                context.iterations.iter().find(|valid_iteration| {
                    valid_iteration.path.eq_ignore_ascii_case(iteration)
                        || valid_iteration.name.eq_ignore_ascii_case(iteration)
                })
            })
            .map(|iteration| iteration.path.clone())
            .or_else(|| context.current_iteration_path.clone())
            .or_else(|| {
                context
                    .iterations
                    .first()
                    .map(|iteration| iteration.path.clone())
            })
            .unwrap_or_default();
        item.insert(
            "iterationPath".to_string(),
            serde_json::Value::String(normalized_iteration),
        );

        if item
            .get("dependencyTemporaryIds")
            .is_none_or(serde_json::Value::is_null)
        {
            item.insert(
                "dependencyTemporaryIds".to_string(),
                serde_json::Value::Array(Vec::new()),
            );
        }
    }
}

fn parse_generated_plan(
    content: &str,
    context: &AiPlannerContext,
    request: &GenerateWorkItemPlanRequest,
) -> Result<GeneratedWorkItemPlan, String> {
    let mut value: serde_json::Value =
        serde_json::from_str(extract_json_content(content)).map_err(|error| error.to_string())?;
    normalize_plan_value(&mut value, context, request);
    let mut plan: GeneratedWorkItemPlan =
        serde_json::from_value(value).map_err(|error| error.to_string())?;
    sanitize_plan_references(&mut plan);
    Ok(plan)
}

fn sanitize_plan_references(plan: &mut GeneratedWorkItemPlan) {
    let temporary_ids: HashSet<String> = plan
        .items
        .iter()
        .map(|item| item.temporary_id.clone())
        .collect();

    for item in &mut plan.items {
        if item.parent_temporary_id.as_ref().is_some_and(|parent_id| {
            parent_id == &item.temporary_id || !temporary_ids.contains(parent_id)
        }) {
            item.parent_temporary_id = None;
        }

        let mut seen_dependencies = HashSet::new();
        item.dependency_temporary_ids.retain(|dependency_id| {
            dependency_id != &item.temporary_id
                && temporary_ids.contains(dependency_id)
                && seen_dependencies.insert(dependency_id.clone())
        });
    }
}

async fn generate_plan_with_backend(
    state: &AppState,
    backend: &ResolvedAiBackend,
    context: &AiPlannerContext,
    request: &GenerateWorkItemPlanRequest,
) -> Result<GeneratedWorkItemPlan, String> {
    let system_prompt = planner_system_prompt(context)?;
    let user_prompt = planner_user_prompt(request)?;

    let content = request_completion(state, backend, &system_prompt, &user_prompt).await?;
    let first_error = match parse_generated_plan(&content, context, request) {
        Ok(plan) => match validate_plan(&plan, context) {
            Ok(()) => return Ok(plan),
            Err(error) => error,
        },
        Err(error) => error,
    };

    let repaired = request_completion(
        state,
        backend,
        &system_prompt,
        &repair_prompt(&content, &first_error),
    )
    .await?;
    let plan = parse_generated_plan(&repaired, context, request).map_err(|error| {
        format!(
            "The AI returned an invalid work-item plan: {error}. Try rephrasing your mission, \
             or use a larger model."
        )
    })?;
    validate_plan(&plan, context).map_err(|error| {
        format!(
            "The AI returned an invalid work-item plan: {error}. Try rephrasing your mission, \
             or use a larger model."
        )
    })?;
    Ok(plan)
}

fn has_cycle(edges: &HashMap<String, Vec<String>>) -> bool {
    fn visit(
        node: &str,
        edges: &HashMap<String, Vec<String>>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> bool {
        if visiting.contains(node) {
            return true;
        }
        if visited.contains(node) {
            return false;
        }
        visiting.insert(node.to_string());
        if edges.get(node).is_some_and(|targets| {
            targets
                .iter()
                .any(|target| visit(target, edges, visiting, visited))
        }) {
            return true;
        }
        visiting.remove(node);
        visited.insert(node.to_string());
        false
    }

    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    edges
        .keys()
        .any(|node| visit(node, edges, &mut visiting, &mut visited))
}

pub(crate) fn validate_plan(
    plan: &GeneratedWorkItemPlan,
    context: &AiPlannerContext,
) -> Result<(), String> {
    if plan.mission.trim().is_empty() {
        return Err("The generated plan has an empty mission".to_string());
    }
    if plan.items.is_empty() {
        return Err("The generated plan contains no work items".to_string());
    }

    let metadata_by_type: HashMap<&str, &AiWorkItemTypeMetadata> = context
        .work_item_types
        .iter()
        .map(|metadata| (metadata.name.as_str(), metadata))
        .collect();
    let valid_iterations: HashSet<&str> = context
        .iterations
        .iter()
        .map(|iteration| iteration.path.as_str())
        .collect();
    let mut temporary_ids = HashSet::new();
    for item in &plan.items {
        if item.temporary_id.trim().is_empty() || !temporary_ids.insert(item.temporary_id.as_str())
        {
            return Err(format!(
                "Generated temporary ID '{}' is empty or duplicated",
                item.temporary_id
            ));
        }
        if item.title.trim().is_empty() {
            return Err(format!(
                "Work item '{}' has an empty title",
                item.temporary_id
            ));
        }
        let metadata = metadata_by_type
            .get(item.work_item_type.as_str())
            .ok_or_else(|| {
                format!(
                    "Work item '{}' uses unsupported type '{}'",
                    item.temporary_id, item.work_item_type
                )
            })?;
        if !metadata.states.iter().any(|state| state == &item.state) {
            return Err(format!(
                "State '{}' is not valid for work-item type '{}'",
                item.state, item.work_item_type
            ));
        }
        if !valid_iterations.contains(item.iteration_path.as_str()) {
            return Err(format!(
                "Iteration '{}' is not available on the current board",
                item.iteration_path
            ));
        }
    }

    let mut hierarchy_edges = HashMap::<String, Vec<String>>::new();
    let mut dependency_edges = HashMap::<String, Vec<String>>::new();
    for item in &plan.items {
        if let Some(parent_id) = &item.parent_temporary_id {
            if !temporary_ids.contains(parent_id.as_str()) {
                return Err(format!(
                    "Work item '{}' references missing parent '{}'",
                    item.temporary_id, parent_id
                ));
            }
            hierarchy_edges
                .entry(parent_id.clone())
                .or_default()
                .push(item.temporary_id.clone());
        }
        for predecessor_id in &item.dependency_temporary_ids {
            if !temporary_ids.contains(predecessor_id.as_str()) {
                return Err(format!(
                    "Work item '{}' references missing dependency '{}'",
                    item.temporary_id, predecessor_id
                ));
            }
            dependency_edges
                .entry(predecessor_id.clone())
                .or_default()
                .push(item.temporary_id.clone());
        }
    }
    if has_cycle(&hierarchy_edges) {
        return Err("The generated parent hierarchy contains a cycle".to_string());
    }
    if has_cycle(&dependency_edges) {
        return Err("The generated dependency graph contains a cycle".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_ai_planner_context(
    state: State<'_, AppState>,
) -> Result<AiPlannerContext, String> {
    planner_context(&state).await
}

#[tauri::command]
pub async fn generate_work_item_plan(
    state: State<'_, AppState>,
    request: GenerateWorkItemPlanRequest,
) -> Result<GeneratedWorkItemPlan, String> {
    if request.mission.trim().is_empty() {
        return Err("Describe the mission before generating work items".to_string());
    }
    let (context, backend) = planner_context_with_backend(&state).await?;
    let backend = backend?;
    let plan = generate_plan_with_backend(&state, &backend, &context, &request).await?;
    validate_plan(&plan, &context)?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{GeneratedWorkItem, Iteration};

    fn context() -> AiPlannerContext {
        AiPlannerContext {
            work_item_types: vec![AiWorkItemTypeMetadata {
                name: "Task".to_string(),
                initial_state: "Proposed".to_string(),
                states: vec!["Proposed".to_string(), "Active".to_string()],
            }],
            iterations: vec![Iteration {
                id: "current".to_string(),
                name: "Current".to_string(),
                path: "Project\\Current".to_string(),
                start_date: None,
                finish_date: None,
            }],
            current_iteration_path: Some("Project\\Current".to_string()),
            assigned_to: "user@example.com".to_string(),
            ai_provider: Some("azureOpenAi".to_string()),
            ai_ready: true,
            ai_error: None,
        }
    }

    fn valid_plan() -> GeneratedWorkItemPlan {
        GeneratedWorkItemPlan {
            mission: "Build a feature".to_string(),
            items: vec![GeneratedWorkItem {
                temporary_id: "task-1".to_string(),
                parent_temporary_id: None,
                work_item_type: "Task".to_string(),
                state: "Proposed".to_string(),
                title: "Implement feature".to_string(),
                description: String::new(),
                acceptance_criteria: String::new(),
                iteration_path: "Project\\Current".to_string(),
                assigned_to: "user@example.com".to_string(),
                dependency_temporary_ids: Vec::new(),
            }],
        }
    }

    #[test]
    fn validates_supported_plan() {
        assert_eq!(validate_plan(&valid_plan(), &context()), Ok(()));
    }

    #[test]
    fn selects_a_real_iteration_when_none_is_current() {
        let past = Iteration {
            id: "past".to_string(),
            name: "Past".to_string(),
            path: "Project\\Past".to_string(),
            start_date: Some("2020-01-01T00:00:00Z".to_string()),
            finish_date: Some("2020-01-14T00:00:00Z".to_string()),
        };
        let recent_past = Iteration {
            id: "recent".to_string(),
            name: "Recent".to_string(),
            path: "Project\\Recent".to_string(),
            start_date: Some("2020-02-01T00:00:00Z".to_string()),
            finish_date: Some("2020-02-14T00:00:00Z".to_string()),
        };
        assert_eq!(
            current_iteration_path(&[past, recent_past]),
            Some("Project\\Recent".to_string())
        );

        let undated = Iteration {
            id: "undated".to_string(),
            name: "Undated".to_string(),
            path: "Project\\Undated".to_string(),
            start_date: None,
            finish_date: None,
        };
        assert_eq!(
            current_iteration_path(&[undated]),
            Some("Project\\Undated".to_string())
        );
    }

    #[test]
    fn safely_defaults_nullable_local_model_fields() {
        let request = GenerateWorkItemPlanRequest {
            mission: "Build a feature".to_string(),
            refinement_request: None,
            current_plan: None,
        };
        let response = r#"{
            "mission": null,
            "items": [{
                "temporaryId": "task-1",
                "parentTemporaryId": null,
                "type": "Task",
                "state": null,
                "title": "Implement feature",
                "description": null,
                "acceptanceCriteria": null,
                "iterationPath": null,
                "assignedTo": null,
                "dependencyTemporaryIds": null
            }]
        }"#;

        let plan = parse_generated_plan(response, &context(), &request).unwrap();
        assert_eq!(plan.mission, "Build a feature");
        assert_eq!(plan.items[0].state, "Proposed");
        assert_eq!(plan.items[0].description, "");
        assert_eq!(plan.items[0].acceptance_criteria, "");
        assert_eq!(plan.items[0].iteration_path, "Project\\Current");
        assert_eq!(plan.items[0].assigned_to, "user@example.com");
        assert!(plan.items[0].dependency_temporary_ids.is_empty());
        assert_eq!(validate_plan(&plan, &context()), Ok(()));
    }

    #[test]
    fn normalizes_iteration_names_and_safe_metadata_values() {
        let request = GenerateWorkItemPlanRequest {
            mission: "Build a feature".to_string(),
            refinement_request: None,
            current_plan: None,
        };
        let response = r#"{
            "mission": "Build a feature",
            "items": [{
                "temporaryId": "task-1",
                "parentTemporaryId": null,
                "type": "task",
                "state": "active",
                "title": "Implement feature",
                "description": "",
                "acceptanceCriteria": "",
                "iterationPath": "Current",
                "assignedTo": "user@example.com",
                "dependencyTemporaryIds": []
            }, {
                "temporaryId": "task-2",
                "parentTemporaryId": null,
                "type": "Task",
                "state": "invented state",
                "title": "Test feature",
                "description": "",
                "acceptanceCriteria": "",
                "iterationPath": "Iteration 1",
                "assignedTo": "user@example.com",
                "dependencyTemporaryIds": []
            }]
        }"#;

        let plan = parse_generated_plan(response, &context(), &request).unwrap();
        assert_eq!(plan.items[0].work_item_type, "Task");
        assert_eq!(plan.items[0].state, "Active");
        assert_eq!(plan.items[0].iteration_path, "Project\\Current");
        assert_eq!(plan.items[1].state, "Proposed");
        assert_eq!(plan.items[1].iteration_path, "Project\\Current");
        assert_eq!(validate_plan(&plan, &context()), Ok(()));
    }

    #[test]
    fn falls_back_to_an_available_iteration_when_context_has_no_current_one() {
        let mut planner_context = context();
        planner_context.current_iteration_path = None;
        let request = GenerateWorkItemPlanRequest {
            mission: "Build a feature".to_string(),
            refinement_request: None,
            current_plan: None,
        };
        let response = r#"{
            "mission": "Build a feature",
            "items": [{
                "temporaryId": "task-1",
                "parentTemporaryId": null,
                "type": "Task",
                "state": "Proposed",
                "title": "Implement feature",
                "description": "",
                "acceptanceCriteria": "",
                "iterationPath": "",
                "assignedTo": "user@example.com",
                "dependencyTemporaryIds": []
            }]
        }"#;

        let plan = parse_generated_plan(response, &planner_context, &request).unwrap();
        assert_eq!(plan.items[0].iteration_path, "Project\\Current");
        assert_eq!(validate_plan(&plan, &planner_context), Ok(()));
    }

    #[test]
    fn keeps_identity_fields_strict() {
        let request = GenerateWorkItemPlanRequest {
            mission: "Build a feature".to_string(),
            refinement_request: None,
            current_plan: None,
        };
        let response = r#"{
            "mission": "Build a feature",
            "items": [{
                "temporaryId": null,
                "parentTemporaryId": null,
                "type": "Task",
                "state": "Proposed",
                "title": "Implement feature",
                "description": "",
                "acceptanceCriteria": "",
                "iterationPath": "Project\\Current",
                "assignedTo": "user@example.com",
                "dependencyTemporaryIds": []
            }]
        }"#;

        assert!(parse_generated_plan(response, &context(), &request)
            .unwrap_err()
            .contains("expected a string"));
    }

    #[test]
    fn removes_broken_ai_generated_references() {
        let request = GenerateWorkItemPlanRequest {
            mission: "Build a feature".to_string(),
            refinement_request: None,
            current_plan: None,
        };
        let response = r#"{
            "mission": "Build a feature",
            "items": [{
                "temporaryId": "task-1",
                "parentTemporaryId": "missing-parent",
                "type": "Task",
                "state": "Proposed",
                "title": "Implement feature",
                "description": "",
                "acceptanceCriteria": "",
                "iterationPath": "Project\\Current",
                "assignedTo": "user@example.com",
                "dependencyTemporaryIds": ["task-1", "missing-dependency"]
            }]
        }"#;

        let plan = parse_generated_plan(response, &context(), &request).unwrap();
        assert_eq!(plan.items[0].parent_temporary_id, None);
        assert!(plan.items[0].dependency_temporary_ids.is_empty());
        assert_eq!(validate_plan(&plan, &context()), Ok(()));
    }

    #[test]
    fn rejects_invalid_state() {
        let mut plan = valid_plan();
        plan.items[0].state = "New".to_string();
        assert!(validate_plan(&plan, &context())
            .unwrap_err()
            .contains("not valid"));
    }

    #[test]
    fn rejects_dependency_cycle() {
        let mut plan = valid_plan();
        plan.items.push(GeneratedWorkItem {
            temporary_id: "task-2".to_string(),
            parent_temporary_id: None,
            work_item_type: "Task".to_string(),
            state: "Proposed".to_string(),
            title: "Review feature".to_string(),
            description: String::new(),
            acceptance_criteria: String::new(),
            iteration_path: "Project\\Current".to_string(),
            assigned_to: "user@example.com".to_string(),
            dependency_temporary_ids: vec!["task-1".to_string()],
        });
        plan.items[0].dependency_temporary_ids = vec!["task-2".to_string()];
        assert!(validate_plan(&plan, &context())
            .unwrap_err()
            .contains("dependency graph contains a cycle"));
    }
}
