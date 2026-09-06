use crate::models::*;
use crate::state::AppState;
use base64::Engine;

const WORK_ITEM_BATCH_SIZE: usize = 200;
const SPRINT_WINDOW: usize = 3; // sprints before and after current

/// Check an HTTP response for non-success status and return a descriptive error.
/// On success, returns the response unchanged for further processing.
pub(crate) async fn check_response(
    resp: reqwest::Response,
    context: &str,
) -> Result<reqwest::Response, String> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(format!("{context} failed ({status}): {body}"))
}

/// Escape single quotes for safe interpolation into WIQL string literals.
fn escape_wiql(value: &str) -> String {
    value.replace('\'', "''")
}

#[derive(Debug, Clone)]
struct IterationInfo {
    path: String,
    name: String,
    start: Option<chrono::DateTime<chrono::Utc>>,
    finish: Option<chrono::DateTime<chrono::Utc>>,
}

/// Collect all leaf-level iterations from the classification tree,
/// filtered to the product subtree matching the area path.
async fn fetch_product_iterations(state: &AppState) -> Result<Vec<IterationInfo>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/classificationnodes/Iterations?$depth=10&api-version=7.1",
        config.organization, config.project
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Iterations request failed: {e}"))?;

    let resp = check_response(resp, "Iterations").await?;

    let tree: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Iterations parse error: {}", e))?;

    let mut all_iters = Vec::new();
    collect_leaf_iterations(&tree, "", &mut all_iters);

    // Filter to iterations matching the product from the area path
    let area_parts: Vec<&str> = config.area_path.split('\\').collect();
    if let Some(product) = area_parts.get(1) {
        let filtered: Vec<_> = all_iters
            .into_iter()
            .filter(|i| i.path.contains(product))
            .collect();
        if !filtered.is_empty() {
            return Ok(filtered);
        }
    }

    Ok(Vec::new())
}

fn collect_leaf_iterations(
    node: &serde_json::Value,
    prefix: &str,
    results: &mut Vec<IterationInfo>,
) {
    let name = node["name"].as_str().unwrap_or("").to_string();
    let full_path = if prefix.is_empty() {
        name.clone()
    } else {
        format!("{}\\{}", prefix, name)
    };

    let start = node["attributes"]["startDate"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc));
    let finish = node["attributes"]["finishDate"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc));

    let children = node["children"].as_array();
    let has_children = children.is_some_and(|c| !c.is_empty());

    if has_children {
        for child in children.unwrap() {
            collect_leaf_iterations(child, &full_path, results);
        }
    } else if start.is_some() && finish.is_some() {
        results.push(IterationInfo {
            path: full_path,
            name,
            start,
            finish,
        });
    }
}

/// Get the sprint window: current ± SPRINT_WINDOW leaf iterations.
/// Returns the iteration paths to include in the WIQL filter.
fn get_sprint_window(iterations: &[IterationInfo]) -> Vec<String> {
    let mut sorted: Vec<_> = iterations.iter().collect();
    sorted.sort_by(|a, b| a.start.cmp(&b.start));

    let now = chrono::Utc::now();
    let current_idx = sorted.iter().position(|i| match (i.start, i.finish) {
        (Some(s), Some(f)) => s <= now && now <= f,
        _ => false,
    });

    let center = current_idx.unwrap_or_else(|| {
        // If no current sprint, find the nearest future one
        sorted
            .iter()
            .position(|i| i.start.map(|s| s > now).unwrap_or(false))
            .unwrap_or(0)
    });

    let start = center.saturating_sub(SPRINT_WINDOW);
    let end = (center + SPRINT_WINDOW + 1).min(sorted.len());

    sorted[start..end].iter().map(|i| i.path.clone()).collect()
}

pub async fn fetch_iterations(state: &AppState) -> Result<Vec<Iteration>, String> {
    let product_iters = fetch_product_iterations(state).await?;
    let window_paths = get_sprint_window(&product_iters);

    // Return only iterations in the window, with dates
    Ok(product_iters
        .iter()
        .filter(|i| window_paths.contains(&i.path))
        .map(|i| Iteration {
            id: i.path.clone(), // use path as ID since we don't have the GUID
            name: i.name.clone(),
            path: i.path.clone(),
            start_date: i.start.map(|d| d.to_rfc3339()),
            finish_date: i.finish.map(|d| d.to_rfc3339()),
        })
        .collect())
}

pub async fn fetch_work_items(state: &AppState) -> Result<Vec<WorkItem>, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;

    // Get the sprint window paths for the WIQL filter
    let product_iters = fetch_product_iterations(state).await?;
    let window_paths = get_sprint_window(&product_iters);

    let wiql_url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/wiql?api-version=7.1",
        config.organization, config.project
    );

    let wiql_query = if window_paths.is_empty() {
        // Fallback: no iteration info, just use area + @Me
        format!(
            "SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '{}' AND [System.AssignedTo] = @Me",
            escape_wiql(&config.area_path)
        )
    } else {
        // Build OR condition for iteration paths
        let iter_conditions: Vec<String> = window_paths
            .iter()
            .map(|p| format!("[System.IterationPath] = '{}'", escape_wiql(p)))
            .collect();
        format!(
            "SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '{}' AND [System.AssignedTo] = @Me AND ({})",
            escape_wiql(&config.area_path),
            iter_conditions.join(" OR ")
        )
    };

    #[cfg(debug_assertions)]
    eprintln!("[DEBUG] WIQL: {}", wiql_query);

    let wiql_body = serde_json::json!({ "query": wiql_query });

    let resp = state
        .http_client
        .post(&wiql_url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json")
        .json(&wiql_body)
        .send()
        .await
        .map_err(|e| format!("WIQL request failed: {e}"))?;

    let resp = check_response(resp, "WIQL query").await?;

    let wiql_data: WiqlResponse = resp
        .json()
        .await
        .map_err(|e| format!("WIQL parse error: {}", e))?;

    let all_ids: Vec<i64> = wiql_data.work_items.into_iter().map(|w| w.id).collect();

    if all_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: Fetch work items in batches of 200
    let mut all_work_items = Vec::new();

    for chunk in all_ids.chunks(WORK_ITEM_BATCH_SIZE) {
        let ids_str: String = chunk
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        let url = format!(
            "https://dev.azure.com/{}/{}/_apis/wit/workitems?ids={}&$expand=relations&api-version=7.1&errorPolicy=Omit",
            config.organization, config.project, ids_str
        );

        let resp = state
            .http_client
            .get(&url)
            .header("Authorization", &auth)
            .send()
            .await
            .map_err(|e| format!("Work items request failed: {e}"))?;

        let resp = check_response(resp, "Work items").await?;

        let data: WorkItemsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Work items parse error: {}", e))?;

        all_work_items.extend(data.value);
    }

    let known_ids: std::collections::HashSet<i64> = all_ids.iter().cloned().collect();
    Ok(convert_ado_work_items(all_work_items, &known_ids))
}

pub async fn fetch_work_item_overview(
    state: &AppState,
    work_item_id: i64,
) -> Result<WorkItemOverview, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let item_url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?$expand=all&api-version=7.1",
        config.organization, config.project, work_item_id
    );

    let response = state
        .http_client
        .get(&item_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Work item overview request failed: {e}"))?;
    let response = check_response(response, "Work item overview").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Work item overview parse error: {e}"))?;

    let fields = body["fields"]
        .as_object()
        .cloned()
        .ok_or_else(|| "Work item overview has no fields".to_string())?;
    let work_item_type = fields["System.WorkItemType"]
        .as_str()
        .ok_or_else(|| "Work item overview has no work item type".to_string())?
        .to_string();

    let encoded_work_item_type = urlencoding::encode(&work_item_type);
    let definition_url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitemtypes/{}/fields?$expand=All&api-version=7.1",
        config.organization, config.project, encoded_work_item_type
    );
    let definition_response = state
        .http_client
        .get(&definition_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Work item field metadata request failed: {e}"))?;
    let definition_response =
        check_response(definition_response, "Work item field metadata").await?;
    let definition: AdoWorkItemTypeFieldsResponse = definition_response
        .json()
        .await
        .map_err(|e| format!("Work item field metadata parse error: {e}"))?;

    let fields_url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/fields?api-version=7.1",
        config.organization, config.project
    );
    let fields_response = state
        .http_client
        .get(&fields_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Work item fields metadata request failed: {e}"))?;
    let fields_response = check_response(fields_response, "Work item fields metadata").await?;
    let fields_metadata: AdoWorkItemTypeFieldsResponse = fields_response
        .json()
        .await
        .map_err(|e| format!("Work item fields metadata parse error: {e}"))?;
    let field_types: std::collections::HashMap<_, _> = fields_metadata
        .value
        .into_iter()
        .map(|field| (field.reference_name, (field.field_type, field.read_only)))
        .collect();
    let field_definitions = definition
        .value
        .into_iter()
        .map(|mut field| {
            if let Some((field_type, read_only)) = field_types.get(&field.reference_name) {
                field.field_type.clone_from(field_type);
                field.read_only = *read_only;
            }
            field
        })
        .collect();

    Ok(WorkItemOverview {
        id: work_item_id,
        work_item_type,
        fields: fields.into_iter().collect(),
        field_definitions,
    })
}

pub async fn search_identities(
    state: &AppState,
    search_text: &str,
) -> Result<Vec<IdentitySearchResult>, String> {
    let trimmed_search_text = search_text.trim();
    if trimmed_search_text.is_empty() {
        return Ok(Vec::new());
    }

    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/_apis/IdentityPicker/Identities?api-version=5.0-preview.1",
        config.organization
    );
    let request_body = serde_json::json!({
        "query": trimmed_search_text,
        "identityTypes": ["user", "servicePrincipal"],
        "operationScopes": ["ims", "source"],
        "options": {
            "MinResults": 5,
            "MaxResults": 40
        },
        "properties": [
            "DisplayName",
            "Mail",
            "SignInAddress",
            "SamAccountName",
            "Active",
            "SubjectDescriptor"
        ]
    });

    let response = state
        .http_client
        .post(&url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Identity picker request failed: {e}"))?;
    let response = check_response(response, "Identity search").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Identity picker parse error: {e}"))?;

    let results = body["results"]
        .as_array()
        .ok_or_else(|| "Identity picker response has no results array".to_string())?;

    let mut identities = Vec::new();
    for result in results {
        let Some(result_identities) = result["identities"].as_array() else {
            continue;
        };

        for identity in result_identities {
            let identity = identity.clone();
            let Some(display_name) = identity["displayName"].as_str() else {
                continue;
            };
            let display_name = display_name.to_string();
            let unique_name = identity["signInAddress"]
                .as_str()
                .or_else(|| identity["samAccountName"].as_str())
                .or_else(|| identity["mail"].as_str())
                .unwrap_or(&display_name)
                .to_string();

            let avatar_data_url = match identity["subjectDescriptor"].as_str() {
                Some(subject_descriptor) => fetch_identity_avatar(
                    &state.http_client,
                    &auth,
                    &config.organization,
                    subject_descriptor,
                )
                .await
                .ok(),
                None => None,
            };

            identities.push(IdentitySearchResult {
                display_name,
                unique_name,
                avatar_data_url,
            });
        }
    }

    Ok(identities)
}

async fn fetch_identity_avatar(
    http_client: &reqwest::Client,
    auth: &str,
    organization: &str,
    subject_descriptor: &str,
) -> Result<String, String> {
    let encoded_descriptor = urlencoding::encode(subject_descriptor);
    let url = format!(
        "https://vssps.dev.azure.com/{organization}/_apis/graph/Subjects/{encoded_descriptor}/avatars?size=small&format=png&api-version=7.1"
    );
    let response = http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|e| format!("Identity avatar request failed: {e}"))?;
    let response = check_response(response, "Identity avatar").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Identity avatar parse error: {e}"))?;
    let bytes = body["value"]
        .as_array()
        .ok_or_else(|| "Identity avatar response has no value array".to_string())?
        .iter()
        .map(|byte| {
            byte.as_u64()
                .and_then(|value| u8::try_from(value).ok())
                .ok_or_else(|| "Identity avatar contains an invalid byte".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Convert ADO work items to frontend types, resolving relations.
/// Only includes relations where the linked ID is in the `known_ids` set.
fn convert_ado_work_items(
    ado_items: Vec<AdoWorkItem>,
    known_ids: &std::collections::HashSet<i64>,
) -> Vec<WorkItem> {
    ado_items
        .into_iter()
        .map(|item| {
            let mut predecessors = Vec::new();
            let mut successors = Vec::new();
            let mut parent_id = None;
            let mut children = Vec::new();

            if let Some(relations) = &item.relations {
                for rel in relations {
                    let linked_id = extract_id_from_url(&rel.url);
                    if linked_id == 0 {
                        continue;
                    }

                    // Only include relations to items we know about (in-scope)
                    if !known_ids.contains(&linked_id) {
                        continue;
                    }

                    match rel.rel.as_str() {
                        // Dependency-Forward: this item's successor (linked item depends on this)
                        "System.LinkTypes.Dependency-Forward" => {
                            successors.push(linked_id);
                        }
                        // Dependency-Reverse: this item's predecessor (this item depends on linked)
                        "System.LinkTypes.Dependency-Reverse" => {
                            predecessors.push(linked_id);
                        }
                        // Hierarchy-Forward: linked item is a child
                        "System.LinkTypes.Hierarchy-Forward" => {
                            children.push(linked_id);
                        }
                        // Hierarchy-Reverse: linked item is the parent
                        "System.LinkTypes.Hierarchy-Reverse" => {
                            parent_id = Some(linked_id);
                        }
                        _ => {}
                    }
                }
            }

            WorkItem {
                id: item.id,
                title: item.fields.title,
                state: item.fields.state,
                work_item_type: item.fields.work_item_type,
                assigned_to: item.fields.assigned_to.map(|a| a.display_name),
                iteration_path: item.fields.iteration_path,
                area_path: item.fields.area_path,
                predecessors,
                successors,
                parent_id,
                children,
            }
        })
        .collect()
}

fn extract_id_from_url(url: &str) -> i64 {
    url.rsplit('/')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};
    use serde_json::json;

    fn parse_utc(value: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    fn iteration(
        path: &str,
        start: chrono::DateTime<chrono::Utc>,
        finish: chrono::DateTime<chrono::Utc>,
    ) -> IterationInfo {
        IterationInfo {
            path: path.to_string(),
            name: path.rsplit('\\').next().unwrap().to_string(),
            start: Some(start),
            finish: Some(finish),
        }
    }

    #[test]
    fn collect_leaf_iterations_nested_tree() {
        let tree = json!({
            "name": "Root",
            "children": [
                {
                    "name": "ChildA",
                    "children": [
                        {
                            "name": "Sprint1",
                            "attributes": {
                                "startDate": "2025-01-06T00:00:00Z",
                                "finishDate": "2025-01-19T00:00:00Z"
                            }
                        }
                    ]
                },
                {
                    "name": "ChildB",
                    "children": [
                        {
                            "name": "Sprint2",
                            "attributes": {
                                "startDate": "2025-01-20T00:00:00Z",
                                "finishDate": "2025-02-02T00:00:00Z"
                            }
                        }
                    ]
                }
            ]
        });

        let mut results = Vec::new();
        collect_leaf_iterations(&tree, "", &mut results);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].path, "Root\\ChildA\\Sprint1");
        assert_eq!(results[0].name, "Sprint1");
        assert_eq!(results[0].start, Some(parse_utc("2025-01-06T00:00:00Z")));
        assert_eq!(results[0].finish, Some(parse_utc("2025-01-19T00:00:00Z")));
        assert_eq!(results[1].path, "Root\\ChildB\\Sprint2");
        assert_eq!(results[1].name, "Sprint2");
    }

    #[test]
    fn collect_leaf_iterations_leaf_with_dates() {
        let tree = json!({
            "name": "Sprint1",
            "attributes": {
                "startDate": "2025-01-06T00:00:00Z",
                "finishDate": "2025-01-19T00:00:00Z"
            }
        });

        let mut results = Vec::new();
        collect_leaf_iterations(&tree, "Root", &mut results);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "Root\\Sprint1");
        assert_eq!(results[0].name, "Sprint1");
    }

    #[test]
    fn collect_leaf_iterations_leaf_without_dates() {
        let tree = json!({ "name": "Sprint1" });

        let mut results = Vec::new();
        collect_leaf_iterations(&tree, "Root", &mut results);

        assert!(results.is_empty());
    }

    #[test]
    fn collect_leaf_iterations_non_leaf_node_recurses_only() {
        let tree = json!({
            "name": "Root",
            "attributes": {
                "startDate": "2025-01-01T00:00:00Z",
                "finishDate": "2025-01-31T00:00:00Z"
            },
            "children": [
                {
                    "name": "Child",
                    "attributes": {
                        "startDate": "2025-02-01T00:00:00Z",
                        "finishDate": "2025-02-14T00:00:00Z"
                    }
                }
            ]
        });

        let mut results = Vec::new();
        collect_leaf_iterations(&tree, "", &mut results);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "Root\\Child");
        assert!(results.iter().all(|item| item.path != "Root"));
    }

    #[test]
    fn collect_leaf_iterations_empty_tree() {
        let tree = json!({ "name": "Root", "children": [] });

        let mut results = Vec::new();
        collect_leaf_iterations(&tree, "", &mut results);

        assert!(results.is_empty());
    }

    #[test]
    fn collect_leaf_iterations_deep_nesting() {
        let tree = json!({
            "name": "Root",
            "children": [
                {
                    "name": "Program",
                    "children": [
                        {
                            "name": "Release",
                            "children": [
                                {
                                    "name": "Sprint3",
                                    "attributes": {
                                        "startDate": "2025-03-03T00:00:00Z",
                                        "finishDate": "2025-03-16T00:00:00Z"
                                    }
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        let mut results = Vec::new();
        collect_leaf_iterations(&tree, "", &mut results);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "Root\\Program\\Release\\Sprint3");
        assert_eq!(results[0].name, "Sprint3");
    }

    #[test]
    fn get_sprint_window_current_in_middle() {
        let now = Utc::now();
        let iterations = vec![
            iteration(
                "Sprint0",
                now - Duration::days(60),
                now - Duration::days(50),
            ),
            iteration(
                "Sprint1",
                now - Duration::days(40),
                now - Duration::days(30),
            ),
            iteration(
                "Sprint2",
                now - Duration::days(20),
                now - Duration::days(10),
            ),
            iteration("Sprint3", now - Duration::days(1), now + Duration::days(1)),
            iteration(
                "Sprint4",
                now + Duration::days(10),
                now + Duration::days(20),
            ),
            iteration(
                "Sprint5",
                now + Duration::days(30),
                now + Duration::days(40),
            ),
            iteration(
                "Sprint6",
                now + Duration::days(50),
                now + Duration::days(60),
            ),
        ];

        assert_eq!(
            get_sprint_window(&iterations),
            vec!["Sprint0", "Sprint1", "Sprint2", "Sprint3", "Sprint4", "Sprint5", "Sprint6"]
        );
    }

    #[test]
    fn get_sprint_window_current_at_start() {
        let now = Utc::now();
        let iterations = vec![
            iteration("Sprint0", now - Duration::days(5), now + Duration::days(5)),
            iteration(
                "Sprint1",
                now + Duration::days(10),
                now + Duration::days(20),
            ),
            iteration(
                "Sprint2",
                now + Duration::days(30),
                now + Duration::days(40),
            ),
            iteration(
                "Sprint3",
                now + Duration::days(50),
                now + Duration::days(60),
            ),
        ];

        assert_eq!(
            get_sprint_window(&iterations),
            vec!["Sprint0", "Sprint1", "Sprint2", "Sprint3"]
        );
    }

    #[test]
    fn get_sprint_window_current_at_end() {
        let now = Utc::now();
        let iterations = vec![
            iteration(
                "Sprint0",
                now - Duration::days(60),
                now - Duration::days(50),
            ),
            iteration(
                "Sprint1",
                now - Duration::days(40),
                now - Duration::days(30),
            ),
            iteration(
                "Sprint2",
                now - Duration::days(20),
                now - Duration::days(10),
            ),
            iteration("Sprint3", now - Duration::days(5), now + Duration::days(5)),
        ];

        assert_eq!(
            get_sprint_window(&iterations),
            vec!["Sprint0", "Sprint1", "Sprint2", "Sprint3"]
        );
    }

    #[test]
    fn get_sprint_window_no_current_sprint_all_past() {
        let now = Utc::now();
        let iterations = vec![
            iteration(
                "Sprint0",
                now - Duration::days(60),
                now - Duration::days(50),
            ),
            iteration(
                "Sprint1",
                now - Duration::days(40),
                now - Duration::days(30),
            ),
            iteration(
                "Sprint2",
                now - Duration::days(20),
                now - Duration::days(10),
            ),
            iteration("Sprint3", now - Duration::days(9), now - Duration::days(1)),
        ];

        assert_eq!(
            get_sprint_window(&iterations),
            vec!["Sprint0", "Sprint1", "Sprint2", "Sprint3"]
        );
    }

    #[test]
    fn get_sprint_window_fewer_than_window() {
        let now = Utc::now();
        let iterations = vec![
            iteration("Sprint0", now - Duration::days(5), now + Duration::days(5)),
            iteration(
                "Sprint1",
                now + Duration::days(10),
                now + Duration::days(20),
            ),
        ];

        assert_eq!(get_sprint_window(&iterations), vec!["Sprint0", "Sprint1"]);
    }

    #[test]
    fn get_sprint_window_empty_list() {
        let iterations: Vec<IterationInfo> = Vec::new();

        assert!(get_sprint_window(&iterations).is_empty());
    }

    #[test]
    fn get_sprint_window_single_current_iteration() {
        let now = Utc::now();
        let iterations = vec![iteration(
            "Sprint0",
            now - Duration::days(5),
            now + Duration::days(5),
        )];

        assert_eq!(get_sprint_window(&iterations), vec!["Sprint0"]);
    }

    #[test]
    fn extract_id_from_url_valid() {
        assert_eq!(
            extract_id_from_url("https://dev.azure.com/org/project/_apis/wit/workItems/12345"),
            12345
        );
    }

    #[test]
    fn extract_id_from_url_empty() {
        assert_eq!(extract_id_from_url(""), 0);
    }

    #[test]
    fn extract_id_from_url_no_number() {
        assert_eq!(
            extract_id_from_url("https://dev.azure.com/org/project/_apis/wit/workItems/abc"),
            0
        );
    }

    #[test]
    fn extract_id_from_url_trailing_slash() {
        assert_eq!(extract_id_from_url("https://example.com/42/"), 0);
    }

    // --- convert_ado_work_items tests ---

    fn make_ado_item(id: i64, relations: Option<Vec<AdoRelation>>) -> AdoWorkItem {
        AdoWorkItem {
            id,
            fields: AdoWorkItemFields {
                title: format!("Item {}", id),
                state: "Active".to_string(),
                work_item_type: "Task".to_string(),
                assigned_to: None,
                iteration_path: "Project\\Sprint 1".to_string(),
                area_path: "Project\\Area".to_string(),
            },
            relations,
        }
    }

    fn rel(rel_type: &str, linked_id: i64) -> AdoRelation {
        AdoRelation {
            rel: rel_type.to_string(),
            url: format!(
                "https://dev.azure.com/org/project/_apis/wit/workItems/{}",
                linked_id
            ),
        }
    }

    #[test]
    fn convert_maps_dependency_forward_to_successors() {
        let known: std::collections::HashSet<i64> = [1, 2].into_iter().collect();
        let items = vec![make_ado_item(
            1,
            Some(vec![rel("System.LinkTypes.Dependency-Forward", 2)]),
        )];

        let result = convert_ado_work_items(items, &known);

        assert_eq!(result[0].successors, vec![2]);
        assert!(result[0].predecessors.is_empty());
    }

    #[test]
    fn convert_maps_dependency_reverse_to_predecessors() {
        let known: std::collections::HashSet<i64> = [1, 2].into_iter().collect();
        let items = vec![make_ado_item(
            2,
            Some(vec![rel("System.LinkTypes.Dependency-Reverse", 1)]),
        )];

        let result = convert_ado_work_items(items, &known);

        assert_eq!(result[0].predecessors, vec![1]);
        assert!(result[0].successors.is_empty());
    }

    #[test]
    fn convert_maps_hierarchy_relations() {
        let known: std::collections::HashSet<i64> = [1, 2, 3].into_iter().collect();
        let items = vec![make_ado_item(
            1,
            Some(vec![
                rel("System.LinkTypes.Hierarchy-Forward", 2),
                rel("System.LinkTypes.Hierarchy-Forward", 3),
            ]),
        )];

        let result = convert_ado_work_items(items, &known);

        assert_eq!(result[0].children, vec![2, 3]);
        assert!(result[0].parent_id.is_none());
    }

    #[test]
    fn convert_maps_hierarchy_reverse_to_parent() {
        let known: std::collections::HashSet<i64> = [1, 2].into_iter().collect();
        let items = vec![make_ado_item(
            2,
            Some(vec![rel("System.LinkTypes.Hierarchy-Reverse", 1)]),
        )];

        let result = convert_ado_work_items(items, &known);

        assert_eq!(result[0].parent_id, Some(1));
    }

    #[test]
    fn convert_filters_out_of_scope_relations() {
        // Item 99 is NOT in known_ids, so its relation should be excluded
        let known: std::collections::HashSet<i64> = [1, 2].into_iter().collect();
        let items = vec![make_ado_item(
            1,
            Some(vec![
                rel("System.LinkTypes.Dependency-Forward", 2), // in scope
                rel("System.LinkTypes.Dependency-Forward", 99), // out of scope
                rel("System.LinkTypes.Hierarchy-Forward", 99), // out of scope
            ]),
        )];

        let result = convert_ado_work_items(items, &known);

        assert_eq!(result[0].successors, vec![2]);
        assert!(result[0].children.is_empty());
    }

    #[test]
    fn convert_ignores_unknown_relation_types() {
        let known: std::collections::HashSet<i64> = [1, 2].into_iter().collect();
        let items = vec![make_ado_item(
            1,
            Some(vec![rel("System.LinkTypes.Related", 2)]),
        )];

        let result = convert_ado_work_items(items, &known);

        assert!(result[0].successors.is_empty());
        assert!(result[0].predecessors.is_empty());
        assert!(result[0].children.is_empty());
        assert!(result[0].parent_id.is_none());
    }

    #[test]
    fn convert_handles_no_relations() {
        let known: std::collections::HashSet<i64> = [1].into_iter().collect();
        let items = vec![make_ado_item(1, None)];

        let result = convert_ado_work_items(items, &known);

        assert!(result[0].predecessors.is_empty());
        assert!(result[0].successors.is_empty());
        assert!(result[0].children.is_empty());
        assert!(result[0].parent_id.is_none());
        assert_eq!(result[0].title, "Item 1");
    }

    #[test]
    fn escape_wiql_no_quotes() {
        assert_eq!(escape_wiql("Project\\Sprint 1"), "Project\\Sprint 1");
    }

    #[test]
    fn escape_wiql_single_quotes() {
        assert_eq!(escape_wiql("Team's Area"), "Team''s Area");
    }

    #[test]
    fn escape_wiql_multiple_quotes() {
        assert_eq!(escape_wiql("It's Bob's"), "It''s Bob''s");
    }

    #[test]
    fn escape_wiql_consecutive_quotes() {
        assert_eq!(escape_wiql("a''b"), "a''''b");
    }

    #[test]
    fn escape_wiql_empty() {
        assert_eq!(escape_wiql(""), "");
    }
}
