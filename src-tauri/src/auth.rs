use std::collections::HashMap;
use std::time::Duration;

use oauth2::{CsrfToken, PkceCodeChallenge};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const CLIENT_ID: &str = "91f5dbd1-2a6b-438f-a561-5cd8aa49c9be";
const AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ADO_SCOPE: &str = "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation offline_access";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum AuthSource {
    #[default]
    OAuthBrowser,
    AzCli,
    Pat,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    pub source: AuthSource,
}

pub fn pat_tokens(pat: String) -> OAuthTokens {
    OAuthTokens {
        access_token: pat,
        refresh_token: None,
        expires_at: chrono::DateTime::<chrono::Utc>::MAX_UTC,
        source: AuthSource::Pat,
    }
}

const ADO_RESOURCE_ID: &str = "499b84ac-1321-427f-aa17-267ca6975798";

pub async fn get_az_cli_token() -> Result<OAuthTokens, String> {
    // On Windows, az is a .cmd file and must be invoked via cmd.exe.
    #[cfg(windows)]
    let output = tokio::process::Command::new("cmd")
        .args(["/c", "az", "account", "get-access-token", "--resource", ADO_RESOURCE_ID])
        .output()
        .await;
    #[cfg(not(windows))]
    let output = tokio::process::Command::new("az")
        .args(["account", "get-access-token", "--resource", ADO_RESOURCE_ID])
        .output()
        .await;

    let output = output.map_err(|e| {
        format!("Failed to run az CLI: {e}. Is the Azure CLI installed and are you logged in?")
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "az CLI error (run 'az login' first): {stderr}"
        ));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse az CLI output: {e}"))?;

    let access_token = json["accessToken"]
        .as_str()
        .ok_or_else(|| "No accessToken in az CLI output".to_string())?
        .to_string();

    // expires_on is a Unix timestamp — more reliable than parsing expiresOn string.
    let expires_at = json["expires_on"]
        .as_i64()
        .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
        .unwrap_or_else(|| chrono::Utc::now() + chrono::Duration::hours(1));

    Ok(OAuthTokens {
        access_token,
        refresh_token: None,
        expires_at,
        source: AuthSource::AzCli,
    })
}

pub async fn login_browser(http_client: &reqwest::Client) -> Result<OAuthTokens, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not get port: {e}"))?
        .port();
    let redirect_uri = format!("http://localhost:{port}");

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let state_token = CsrfToken::new_random();

    let auth_url = format!(
        "{base}?client_id={client_id}&response_type=code&redirect_uri={redirect_uri}&scope={scope}&code_challenge={challenge}&code_challenge_method=S256&state={state}",
        base = AUTH_URL,
        client_id = urlencoding::encode(CLIENT_ID),
        redirect_uri = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(ADO_SCOPE),
        challenge = urlencoding::encode(pkce_challenge.as_str()),
        state = urlencoding::encode(state_token.secret()),
    );

    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {e}"))?;

    let (mut stream, _) = tokio::time::timeout(LOGIN_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "Timed out waiting for Microsoft sign-in to complete".to_string())?
        .map_err(|e| format!("Failed to accept redirect: {e}"))?;

    let mut buf = [0u8; 8192];
    let n = tokio::time::timeout(LOGIN_TIMEOUT, stream.read(&mut buf))
        .await
        .map_err(|_| "Timed out reading redirect response".to_string())?
        .map_err(|e| format!("Failed to read redirect: {e}"))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let result = extract_auth_response(&request, state_token.secret());
    let response_html = match &result {
        Ok(_) => success_response(),
        Err(message) => error_response(message),
    };
    let _ = stream.write_all(response_html.as_bytes()).await;
    let _ = stream.flush().await;
    drop(stream);
    drop(listener);

    let code = result?;
    exchange_code(http_client, &code, &redirect_uri, &*pkce_verifier.secret()).await
}

fn extract_auth_response(request: &str, expected_state: &str) -> Result<String, String> {
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "Invalid redirect request".to_string())?;
    let query_start = first_line
        .find('?')
        .ok_or_else(|| "No authorization response in redirect".to_string())?;
    let query_end = first_line
        .rfind(' ')
        .ok_or_else(|| "Invalid redirect request line".to_string())?;
    if query_end <= query_start {
        return Err("Invalid redirect request".to_string());
    }

    let query = &first_line[query_start + 1..query_end];
    let params = parse_query_string(query);

    if let Some(error) = params.get("error") {
        let description = params
            .get("error_description")
            .map(String::as_str)
            .unwrap_or("Sign-in was cancelled or failed");
        return Err(format!("{error}: {description}"));
    }

    match params.get("state") {
        Some(state) if state == expected_state => {}
        _ => return Err("Invalid OAuth state returned from Microsoft".to_string()),
    }

    params
        .get("code")
        .cloned()
        .ok_or_else(|| "No authorization code in redirect".to_string())
}

fn parse_query_string(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|param| {
            let mut kv = param.splitn(2, '=');
            let key = kv.next()?;
            let value = kv.next().unwrap_or_default();
            let decode = |s| urlencoding::decode(s).map(|c| c.into_owned()).unwrap_or_else(|_| s.to_owned());
            Some((decode(key), decode(value)))
        })
        .collect()
}

async fn exchange_code(
    http_client: &reqwest::Client,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<OAuthTokens, String> {
    let resp = http_client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("code_verifier", code_verifier),
            ("scope", ADO_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    parse_token_response(resp).await
}

pub async fn refresh_access_token(
    http_client: &reqwest::Client,
    refresh_token: &str,
) -> Result<OAuthTokens, String> {
    let resp = http_client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token),
            ("scope", ADO_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    parse_token_response(resp).await
}

async fn parse_token_response(resp: reqwest::Response) -> Result<OAuthTokens, String> {
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read token response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Token endpoint returned {status}: {body}"));
    }

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse token response: {e}"))?;

    let access_token = json["access_token"]
        .as_str()
        .ok_or_else(|| format!("No access_token in response: {body}"))?
        .to_string();
    let refresh_token = json["refresh_token"].as_str().map(str::to_string);
    let expires_in = json["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in);

    Ok(OAuthTokens {
        access_token,
        refresh_token,
        expires_at,
        source: AuthSource::OAuthBrowser,
    })
}

fn http_response(status: u16, reason: &str, body: &str) -> String {
    format!("HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{body}")
}

fn success_response() -> String {
    http_response(200, "OK", include_str!("auth_success.html"))
}

fn error_response(message: &str) -> String {
    let body = include_str!("auth_error.html")
        .replace("{message}", &html_escape::encode_text(message));
    http_response(400, "Bad Request", &body)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_parser_decodes_values() {
        let params = parse_query_string("code=abc%20123&state=hello%20world");
        assert_eq!(params.get("code").map(String::as_str), Some("abc 123"));
        assert_eq!(params.get("state").map(String::as_str), Some("hello world"));
    }

    #[test]
    fn extract_auth_response_rejects_bad_state() {
        let request = "GET /?code=abc&state=wrong HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let result = extract_auth_response(request, "expected");
        assert_eq!(
            result.unwrap_err(),
            "Invalid OAuth state returned from Microsoft"
        );
    }
}
