use tauri::State;

use crate::ado_client;
use crate::models::*;
use crate::state::AppState;

#[tauri::command]
pub async fn set_pat(state: State<'_, AppState>, pat: String) -> Result<(), String> {
    *state
        .pat
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = Some(pat);
    Ok(())
}

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

/// Get an Entra access token for ADO via Azure CLI.
async fn get_entra_token() -> Result<String, String> {
    // On Windows, `az` is a .cmd script — must invoke via cmd.exe
    #[cfg(target_os = "windows")]
    let az_output = tokio::process::Command::new("cmd")
        .args([
            "/C",
            "az",
            "account",
            "get-access-token",
            "--resource",
            "499b84ac-1321-427f-aa17-267ca6975798",
            "--output",
            "json",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run 'az' CLI. Is it installed? Error: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let az_output = tokio::process::Command::new("az")
        .args([
            "account",
            "get-access-token",
            "--resource",
            "499b84ac-1321-427f-aa17-267ca6975798",
            "--output",
            "json",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run 'az' CLI. Is it installed? Error: {}", e))?;

    if !az_output.status.success() {
        let stderr = String::from_utf8_lossy(&az_output.stderr);
        return Err(format!(
            "Azure CLI failed. Run 'az login' first.\n{}",
            stderr
        ));
    }

    let az_token: AzAccessTokenOutput =
        serde_json::from_slice(&az_output.stdout).map_err(|e| format!("Parse error: {}", e))?;

    Ok(az_token.access_token)
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

/// Discover orgs accessible to the user using an Entra bearer token.
async fn discover_orgs_via_entra(
    client: &reqwest::Client,
    bearer: &str,
) -> Result<Vec<AccountInfo>, String> {
    let resp = client
        .get("https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1")
        .header("Authorization", format!("Bearer {}", bearer))
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
        .header("Authorization", format!("Bearer {}", bearer))
        .send()
        .await
        .map_err(|e| format!("Accounts request failed: {e}"))?;

    let resp = crate::ado_client::check_response(resp, "Accounts").await?;

    let resp_text = resp
        .text()
        .await
        .map_err(|e| format!("Read error: {e}"))?;

    parse_and_sort_accounts(&resp_text)
}

/// Generate a PAT using Azure CLI's Entra token + ADO PAT Create API.
/// Auto-discovers the organization. If `organization` is provided, uses it;
/// otherwise discovers orgs and picks the first (or only) one.
#[tauri::command]
pub async fn generate_pat(
    state: State<'_, AppState>,
    organization: Option<String>,
) -> Result<PatGenerationResult, String> {
    let bearer = get_entra_token().await?;

    // Resolve the organization
    let org = if let Some(o) = organization.filter(|s| !s.is_empty()) {
        o
    } else {
        let orgs = discover_orgs_via_entra(&state.http_client, &bearer).await?;
        if orgs.is_empty() {
            return Err("No Azure DevOps organizations found for your account.".to_string());
        }
        if orgs.len() > 1 {
            let names: Vec<String> = orgs.iter().map(|a| a.account_name.clone()).collect();
            return Err(format!(
                "MULTIPLE_ORGS:{}",
                names.join(",")
            ));
        }
        orgs[0].account_name.clone()
    };

    // Build PAT create request
    let now = chrono::Utc::now();
    let valid_to = now + chrono::Duration::days(7);
    let display_name = format!("DecentAdoBoard-{}", now.format("%Y%m%dT%H%M%SZ"));

    let payload = PatCreateRequest {
        display_name: display_name.clone(),
        scope: "vso.profile vso.work_full vso.build_execute vso.code_full vso.code_status vso.packaging"
            .to_string(),
        valid_to: valid_to.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        all_orgs: false,
    };

    let endpoint = format!(
        "https://vssps.dev.azure.com/{}/_apis/tokens/pats?api-version=7.1-preview.1",
        org
    );

    let resp = state
        .http_client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("PAT create request failed: {}", e))?;

    let resp_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let pat_resp: PatCreateResponse = serde_json::from_str(&resp_text)
        .map_err(|e| format!("Parse error: {}\n{}", e, resp_text))?;

    let error = pat_resp.pat_token_error.as_deref().unwrap_or("unknown");
    if error != "none" {
        return Err(format!("PAT creation failed: {}\n{}", error, resp_text));
    }

    let token_info = pat_resp.pat_token.ok_or("No patToken in response")?;
    let token = token_info.token.ok_or("No token value in response")?;

    // Store the PAT in app state
    *state
        .pat
        .lock()
        .map_err(|e| format!("Lock error: {}", e))? = Some(token.clone());

    Ok(PatGenerationResult {
        pat: token,
        organization: org,
        display_name,
        valid_to: token_info
            .valid_to
            .unwrap_or_else(|| valid_to.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
    })
}

/// List ADO organizations accessible to the authenticated user.
/// Tries Entra token (az CLI) first since PATs are often org-scoped,
/// falls back to PAT-based auth.
#[tauri::command]
pub async fn list_organizations(state: State<'_, AppState>) -> Result<Vec<AccountInfo>, String> {
    // Try Entra token first (works across orgs)
    if let Ok(bearer) = get_entra_token().await {
        if let Ok(accounts) = discover_orgs_via_entra(&state.http_client, &bearer).await {
            if !accounts.is_empty() {
                return Ok(accounts);
            }
        }
    }

    // Fall back to PAT-based auth
    let auth = state.get_auth_header()?;

    let profile_resp = state
        .http_client
        .get("https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1")
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Profile request failed: {}", e))?;

    let status = profile_resp.status();
    let profile_text = profile_resp
        .text()
        .await
        .map_err(|e| format!("Profile read error: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Could not list organizations. Try typing the name manually.\n{}",
            profile_text
        ));
    }

    let profile_json: serde_json::Value = serde_json::from_str(&profile_text)
        .map_err(|e| format!("Profile parse error: {}\n{}", e, profile_text))?;

    let member_id = profile_json["id"]
        .as_str()
        .ok_or_else(|| format!("No 'id' in profile response: {}", profile_text))?;

    let url = format!(
        "https://app.vssps.visualstudio.com/_apis/accounts?memberId={}&api-version=7.1",
        member_id
    );

    let acct_resp = state
        .http_client
        .get(&url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("Accounts request failed: {}", e))?;

    let acct_status = acct_resp.status();
    let resp_text = acct_resp
        .text()
        .await
        .map_err(|e| format!("Read error: {}", e))?;

    if !acct_status.is_success() {
        return Err(format!(
            "Accounts API returned {}. Try typing the organization name manually.\n{}",
            acct_status, resp_text
        ));
    }

    parse_and_sort_accounts(&resp_text)
}

/// List projects in an organization.
#[tauri::command]
pub async fn list_projects(
    state: State<'_, AppState>,
    organization: String,
) -> Result<Vec<ProjectInfo>, String> {
    let auth = state.get_auth_header()?;
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

/// List teams in a project.
#[tauri::command]
pub async fn list_teams(
    state: State<'_, AppState>,
    organization: String,
    project: String,
) -> Result<Vec<TeamInfo>, String> {
    let auth = state.get_auth_header()?;
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

/// List area paths in a project (flattened from the tree).
#[tauri::command]
pub async fn list_area_paths(
    state: State<'_, AppState>,
    organization: String,
    project: String,
) -> Result<Vec<String>, String> {
    let auth = state.get_auth_header()?;
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
