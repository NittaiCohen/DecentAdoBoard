use crate::ado_client::check_response;

const FOUNDRY_LOCAL_ENDPOINT_ENV: &str = "DECENT_ADO_BOARD_FOUNDRY_LOCAL_ENDPOINT";
const FOUNDRY_LOCAL_MODEL_ENV: &str = "DECENT_ADO_BOARD_FOUNDRY_LOCAL_MODEL";
const PREFERRED_MODELS: [&str; 3] = ["phi-4", "phi-3.5-mini", "qwen2.5-7b"];
/// Local generation includes a first-request model load, so it needs far more headroom than
/// the shared client's default timeout allows.
const GENERATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

#[derive(Debug, Clone, PartialEq)]
pub struct FoundryLocalConfig {
    pub base_url: String,
    pub model: String,
}

/// Foundry Local assigns a dynamic port, so the base URL is discovered instead of hardcoded.
/// The CLI is used only to locate the service; generation itself uses the REST contract.
fn parse_endpoint_from_status(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|token| {
        let candidate = token.trim_matches(|character: char| {
            !character.is_ascii_alphanumeric() && !matches!(character, ':' | '/' | '.' | '-' | '_')
        });
        (candidate.starts_with("http://") || candidate.starts_with("https://"))
            .then(|| candidate.to_string())
    })
}

/// `foundry server status` exits 0 in every state, including when the server is stopped, so
/// the state must be read from stdout rather than inferred from the exit code.
#[derive(Debug, PartialEq)]
enum ServerStatus {
    Running(String),
    Initializing,
    NotRunning,
    Unrecognized,
}

fn parse_server_status(output: &str) -> ServerStatus {
    if let Some(endpoint) = parse_endpoint_from_status(output) {
        return ServerStatus::Running(endpoint);
    }
    let lowercased = output.to_lowercase();
    if lowercased.contains("initializing") || lowercased.contains("starting") {
        ServerStatus::Initializing
    } else if lowercased.contains("not running") || lowercased.contains("stopped") {
        ServerStatus::NotRunning
    } else {
        ServerStatus::Unrecognized
    }
}

/// `foundry server status` reports a bare origin while the SDKs report a `/v1` suffix.
/// Both are normalized to a bare origin so callers can append a versioned path safely.
fn normalize_base_url(endpoint: &str) -> String {
    endpoint
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches('/')
        .to_string()
}

/// Foundry Local's `/v1/models` returns concrete variant IDs (for example `Phi-4-cuda-gpu`)
/// while the CLI and chat endpoint also accept coarser aliases such as `phi-4`. Separators are
/// collapsed rather than deleted so that version boundaries survive: `gpt-4` must not be
/// treated as a prefix of `gpt-4.1`.
fn normalize_model_name(model: &str) -> String {
    let mut normalized = String::with_capacity(model.len());
    for character in model.trim().chars() {
        if character.is_ascii_alphanumeric() || character == '.' {
            normalized.extend(character.to_lowercase());
        } else if !normalized.ends_with('-') {
            normalized.push('-');
        }
    }
    normalized.trim_matches('-').to_string()
}

/// Suffix tokens Foundry Local appends to an alias to name a hardware-specific build. Only
/// these may separate a requested alias from a concrete variant ID.
const EXECUTION_PROVIDER_TOKENS: [&str; 9] = [
    "cpu", "gpu", "npu", "cuda", "dml", "directml", "webgpu", "qnn", "generic",
];

fn is_hardware_variant_of(candidate: &str, wanted: &str) -> bool {
    let Some(remainder) = candidate.strip_prefix(wanted) else {
        return false;
    };
    let Some(remainder) = remainder.strip_prefix('-') else {
        return false;
    };
    remainder
        .split('-')
        .all(|token| EXECUTION_PROVIDER_TOKENS.contains(&token))
}

/// Prefers an exact match, then a hardware-specific build of the same alias. Anything else
/// (for example `phi-4-mini-instruct-cuda-gpu` when `phi-4` was asked for) is a different model
/// and is never substituted silently.
fn find_matching_model(available_models: &[String], wanted: &str) -> Option<String> {
    let normalized_wanted = normalize_model_name(wanted);
    if normalized_wanted.is_empty() {
        return None;
    }
    let normalized: Vec<(String, &String)> = available_models
        .iter()
        .map(|model| (normalize_model_name(model), model))
        .collect();

    normalized
        .iter()
        .find(|(candidate, _)| *candidate == normalized_wanted)
        .or_else(|| {
            normalized
                .iter()
                .find(|(candidate, _)| is_hardware_variant_of(candidate, &normalized_wanted))
        })
        .map(|(_, model)| (*model).clone())
}

fn choose_model(
    available_models: &[String],
    requested_model: Option<&str>,
) -> Result<String, String> {
    if let Some(requested) = requested_model {
        // An explicitly requested name is trusted, because the chat endpoint also accepts
        // aliases that never appear verbatim in the model list.
        return Ok(find_matching_model(available_models, requested)
            .unwrap_or_else(|| requested.to_string()));
    }
    if let Some(preferred) = PREFERRED_MODELS
        .iter()
        .find_map(|preferred| find_matching_model(available_models, preferred))
    {
        return Ok(preferred);
    }
    available_models.first().cloned().ok_or_else(|| {
        "Foundry Local has no downloaded models. Run: foundry model download phi-4".to_string()
    })
}

/// `cmd /c` always spawns successfully on Windows, so a missing CLI arrives here as a failed
/// exit code rather than a spawn error. Distinguishing the two keeps the remediation accurate.
fn describe_cli_failure(exit_code: Option<i32>, stderr: &str) -> String {
    let details = stderr.trim();
    let command_not_found = exit_code == Some(9009)
        || details.contains("not recognized")
        || details.contains("command not found");
    if command_not_found {
        "Foundry Local is not installed. Install it with: winget install Microsoft.FoundryLocal"
            .to_string()
    } else if details.is_empty() {
        "Foundry Local is not running. Start it with: foundry server start".to_string()
    } else {
        format!("Foundry Local is not available: {details}")
    }
}

async fn discover_base_url() -> Result<String, String> {
    if let Some(endpoint) = std::env::var(FOUNDRY_LOCAL_ENDPOINT_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(normalize_base_url(&endpoint));
    }

    #[cfg(windows)]
    let output = tokio::process::Command::new("cmd")
        .args(["/c", "foundry", "server", "status"])
        .output()
        .await;
    #[cfg(not(windows))]
    let output = tokio::process::Command::new("foundry")
        .args(["server", "status"])
        .output()
        .await;

    let output = output.map_err(|error| {
        format!("Foundry Local CLI could not be started ({error}). Install it with: winget install Microsoft.FoundryLocal")
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(describe_cli_failure(output.status.code(), &stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    match parse_server_status(&stdout) {
        ServerStatus::Running(endpoint) => Ok(normalize_base_url(&endpoint)),
        ServerStatus::Initializing => Err(
            "Foundry Local is still starting up. The first start downloads hardware acceleration \
             components, which can take several minutes. Try again shortly — you can watch \
             progress with: foundry server logs -f"
                .to_string(),
        ),
        ServerStatus::NotRunning => Err(
            "Foundry Local is installed but not running. Start it with: foundry server start"
                .to_string(),
        ),
        ServerStatus::Unrecognized => Err(format!(
            "Foundry Local did not report a service endpoint. 'foundry server status' said: {}",
            stdout.trim()
        )),
    }
}

async fn list_models(http_client: &reqwest::Client, base_url: &str) -> Result<Vec<String>, String> {
    let response = http_client
        .get(format!("{base_url}/v1/models"))
        .send()
        .await
        .map_err(|error| format!("Failed to reach Foundry Local: {error}"))?;
    let response = check_response(response, "List Foundry Local models").await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse Foundry Local models: {error}"))?;
    Ok(body["data"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model["id"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

pub async fn resolve_config(http_client: &reqwest::Client) -> Result<FoundryLocalConfig, String> {
    let base_url = discover_base_url().await?;
    let available_models = list_models(http_client, &base_url).await?;
    let requested_model = std::env::var(FOUNDRY_LOCAL_MODEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let model = choose_model(&available_models, requested_model.as_deref())?;
    Ok(FoundryLocalConfig { base_url, model })
}

pub async fn generate_chat_completion(
    http_client: &reqwest::Client,
    config: &FoundryLocalConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    });
    let response = http_client
        .post(format!("{}/v1/chat/completions", config.base_url))
        // On-device generation must first load the model into memory and then produce a full
        // JSON plan, which routinely exceeds the client's short default timeout.
        .timeout(GENERATION_TIMEOUT)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!(
                    "Foundry Local did not finish generating within {} seconds. The model may still be loading — try again, or use a smaller model.",
                    GENERATION_TIMEOUT.as_secs()
                )
            } else {
                format!("Foundry Local request failed: {error}")
            }
        })?;
    let response = check_response(response, "Foundry Local generation").await?;
    let response_body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse Foundry Local response: {error}"))?;
    response_body["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "Foundry Local returned no message content".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_endpoint_from_cli_status() {
        assert_eq!(
            parse_endpoint_from_status("Service is running at http://localhost:52701/").as_deref(),
            Some("http://localhost:52701/")
        );
        assert_eq!(parse_endpoint_from_status("Service is not running"), None);
    }

    #[test]
    fn normalizes_bare_and_versioned_endpoints() {
        assert_eq!(
            normalize_base_url("http://localhost:52701/"),
            "http://localhost:52701"
        );
        assert_eq!(
            normalize_base_url("http://localhost:52701/v1"),
            "http://localhost:52701"
        );
    }

    #[test]
    fn never_substitutes_a_different_model_family() {
        let available = vec![
            "Phi-4-mini-instruct-cuda-gpu".to_string(),
            "Phi-4-cuda-gpu".to_string(),
        ];
        // `mini` appears first, but it is a different model and must not be selected.
        assert_eq!(
            choose_model(&available, Some("phi-4")).unwrap(),
            "Phi-4-cuda-gpu"
        );
        assert_eq!(choose_model(&available, None).unwrap(), "Phi-4-cuda-gpu");

        let only_mini = vec!["Phi-4-mini-instruct-cuda-gpu".to_string()];
        assert_eq!(
            choose_model(&only_mini, Some("phi-4")).unwrap(),
            "phi-4",
            "an unmatched alias passes through for the service to resolve"
        );
    }

    #[test]
    fn version_boundaries_are_not_collapsed() {
        let available = vec!["gpt-4.1-cuda-gpu".to_string()];
        assert!(find_matching_model(&available, "gpt-4").is_none());
        assert_eq!(
            find_matching_model(&available, "gpt-4.1").as_deref(),
            Some("gpt-4.1-cuda-gpu")
        );
    }

    #[test]
    fn recognizes_real_server_states() {
        // Captured from Foundry Local CLI 0.10.3, which exits 0 in every one of these states.
        assert_eq!(
            parse_server_status("\u{25a0} note: Server is not running.\n"),
            ServerStatus::NotRunning
        );
        assert_eq!(
            parse_server_status("State Initializing\n"),
            ServerStatus::Initializing
        );
        assert_eq!(
            parse_server_status("State Running\nEndpoint http://localhost:52701/v1\n"),
            ServerStatus::Running("http://localhost:52701/v1".to_string())
        );
        assert_eq!(
            parse_server_status("something unexpected"),
            ServerStatus::Unrecognized
        );
    }

    #[test]
    fn distinguishes_missing_cli_from_stopped_service() {
        assert!(describe_cli_failure(
            Some(9009),
            "'foundry' is not recognized as an internal or external command"
        )
        .contains("not installed"));
        assert!(
            describe_cli_failure(Some(127), "foundry: command not found").contains("not installed")
        );
        assert!(describe_cli_failure(Some(1), "").contains("foundry server start"));
        assert!(describe_cli_failure(Some(1), "model runtime crashed")
            .contains("model runtime crashed"));
    }

    #[test]
    fn requested_model_matches_concrete_variant_or_passes_through() {
        let available = vec!["Phi-4-cuda-gpu".to_string()];
        assert_eq!(
            choose_model(&available, Some("phi-4")).unwrap(),
            "Phi-4-cuda-gpu"
        );
        assert_eq!(
            choose_model(&available, Some("qwen2.5-7b")).unwrap(),
            "qwen2.5-7b"
        );
    }

    #[test]
    fn falls_back_to_preferred_then_first_available_model() {
        let available = vec![
            "qwen2.5-7b-instruct".to_string(),
            "Phi-4-cuda-gpu".to_string(),
        ];
        assert_eq!(choose_model(&available, None).unwrap(), "Phi-4-cuda-gpu");

        let unknown_only = vec!["some-other-model".to_string()];
        assert_eq!(
            choose_model(&unknown_only, None).unwrap(),
            "some-other-model"
        );
        assert!(choose_model(&[], None)
            .unwrap_err()
            .contains("no downloaded models"));
    }
}
