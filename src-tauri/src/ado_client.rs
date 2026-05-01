use crate::models::*;
use crate::state::AppState;

const WORK_ITEM_BATCH_SIZE: usize = 200;
const SPRINT_WINDOW: usize = 2; // sprints before and after current

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
    let auth = state.get_auth_header()?;

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
        .map_err(|e| format!("Iterations tree error: {}", e))?;

    if !resp.status().is_success() {
        return Ok(Vec::new());
    }

    let tree: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Iterations tree parse error: {}", e))?;

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
    let current_idx = sorted.iter().position(|i| {
        match (i.start, i.finish) {
            (Some(s), Some(f)) => s <= now && now <= f,
            _ => false,
        }
    });

    let center = current_idx.unwrap_or_else(|| {
        // If no current sprint, find the nearest future one
        sorted.iter().position(|i| {
            i.start.map(|s| s > now).unwrap_or(false)
        }).unwrap_or(0)
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
    let auth = state.get_auth_header()?;

    // Get the sprint window paths for the WIQL filter
    let product_iters = fetch_product_iterations(state).await.unwrap_or_default();
    let window_paths = get_sprint_window(&product_iters);

    let wiql_url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/wiql?api-version=7.1",
        config.organization, config.project
    );

    let wiql_query = if window_paths.is_empty() {
        // Fallback: no iteration info, just use area + @Me
        format!(
            "SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '{}' AND [System.AssignedTo] = @Me",
            config.area_path
        )
    } else {
        // Build OR condition for iteration paths
        let iter_conditions: Vec<String> = window_paths
            .iter()
            .map(|p| format!("[System.IterationPath] = '{}'", p))
            .collect();
        format!(
            "SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '{}' AND [System.AssignedTo] = @Me AND ({})",
            config.area_path,
            iter_conditions.join(" OR ")
        )
    };
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
        .map_err(|e| format!("WIQL HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("WIQL error ({}): {}", status, body));
    }

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
            .map_err(|e| format!("Work items HTTP error: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Work items error ({}): {}", status, body));
        }

        let data: WorkItemsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Work items parse error: {}", e))?;

        all_work_items.extend(data.value);
    }

    // Step 3: Convert to frontend types, resolving relations
    let known_ids: std::collections::HashSet<i64> =
        all_ids.iter().cloned().collect();

    let work_items: Vec<WorkItem> = all_work_items
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
        .collect();

    Ok(work_items)
}

fn extract_id_from_url(url: &str) -> i64 {
    url.rsplit('/')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}
