use crate::ado_client::check_response;
use crate::models::{AdoConfig, JsonPatchOperation};
use crate::state::AppState;

const JSON_PATCH_CONTENT_TYPE: &str = "application/json-patch+json";

fn work_item_url(config: &AdoConfig, work_item_id: i64) -> String {
    format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{work_item_id}?api-version=7.1",
        config.organization, config.project
    )
}

fn work_item_creation_url(config: &AdoConfig, work_item_type: &str) -> String {
    format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/${}?api-version=7.1",
        config.organization,
        config.project,
        urlencoding::encode(work_item_type)
    )
}

pub(crate) async fn create_work_item_from_patch(
    state: &AppState,
    work_item_type: &str,
    patch: &[JsonPatchOperation],
    context: &str,
) -> Result<i64, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let response = state
        .http_client
        .post(work_item_creation_url(&config, work_item_type))
        .header("Authorization", auth)
        .header("Content-Type", JSON_PATCH_CONTENT_TYPE)
        .json(patch)
        .send()
        .await
        .map_err(|error| format!("{context} request failed: {error}"))?;
    let response = check_response(response, context).await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("{context} response parse error: {error}"))?;

    body["id"]
        .as_i64()
        .ok_or_else(|| format!("{context} response did not contain an id"))
}

pub(crate) async fn patch_work_item(
    state: &AppState,
    work_item_id: i64,
    patch: &[JsonPatchOperation],
    context: &str,
) -> Result<(), String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let response = state
        .http_client
        .patch(work_item_url(&config, work_item_id))
        .header("Authorization", auth)
        .header("Content-Type", JSON_PATCH_CONTENT_TYPE)
        .json(patch)
        .send()
        .await
        .map_err(|error| format!("{context} request failed: {error}"))?;

    check_response(response, context).await?;
    Ok(())
}

pub(crate) async fn fetch_work_item_field_text(
    state: &AppState,
    work_item_id: i64,
    field_reference: &str,
    context: &str,
) -> Result<String, String> {
    let config = state.get_config()?;
    let auth = state.get_bearer_token().await?;
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/wit/workitems/{work_item_id}?$select={}&api-version=7.1",
        config.organization,
        config.project,
        urlencoding::encode(field_reference)
    );
    let response = state
        .http_client
        .get(url)
        .header("Authorization", auth)
        .send()
        .await
        .map_err(|error| format!("{context} request failed: {error}"))?;
    let response = check_response(response, context).await?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("{context} response parse error: {error}"))?;

    body["fields"][field_reference]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("Work item has no {field_reference} field"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn work_item_type_url_encoding_handles_spaces_and_slashes() {
        assert_eq!(
            urlencoding::encode("Product Backlog Item"),
            "Product%20Backlog%20Item"
        );
        assert_eq!(urlencoding::encode("a/b"), "a%2Fb");
    }
}
