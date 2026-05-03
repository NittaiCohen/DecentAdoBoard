use std::sync::Mutex;

use crate::models::AdoConfig;

pub struct AppState {
    pub config: Mutex<Option<AdoConfig>>,
    pub pat: Mutex<Option<String>>,
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(None),
            pat: Mutex::new(None),
            http_client: reqwest::Client::builder()
                .user_agent("DecentAdoBoard/0.1")
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("failed to create HTTP client"),
        }
    }

    pub fn get_auth_header(&self) -> Result<String, String> {
        let pat = self
            .pat
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let pat = pat.as_ref().ok_or("PAT not configured")?;
        let encoded = base64_encode(&format!(":{}", pat));
        Ok(format!("Basic {}", encoded))
    }

    pub fn get_config(&self) -> Result<AdoConfig, String> {
        let config = self
            .config
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        config.clone().ok_or("ADO not configured".to_string())
    }
}

fn base64_encode(input: &str) -> String {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut encoder = Base64Encoder::new(&mut buf);
        encoder.write_all(input.as_bytes()).unwrap();
    }
    String::from_utf8(buf).unwrap()
}

// Minimal base64 encoder to avoid adding a dependency
struct Base64Encoder<'a> {
    output: &'a mut Vec<u8>,
}

impl<'a> Base64Encoder<'a> {
    fn new(output: &'a mut Vec<u8>) -> Self {
        Self { output }
    }
}

impl<'a> std::io::Write for Base64Encoder<'a> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        const CHARS: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for chunk in buf.chunks(3) {
            match chunk.len() {
                3 => {
                    self.output.push(CHARS[(chunk[0] >> 2) as usize]);
                    self.output
                        .push(CHARS[((chunk[0] & 0x03) << 4 | chunk[1] >> 4) as usize]);
                    self.output
                        .push(CHARS[((chunk[1] & 0x0f) << 2 | chunk[2] >> 6) as usize]);
                    self.output.push(CHARS[(chunk[2] & 0x3f) as usize]);
                }
                2 => {
                    self.output.push(CHARS[(chunk[0] >> 2) as usize]);
                    self.output
                        .push(CHARS[((chunk[0] & 0x03) << 4 | chunk[1] >> 4) as usize]);
                    self.output
                        .push(CHARS[((chunk[1] & 0x0f) << 2) as usize]);
                    self.output.push(b'=');
                }
                1 => {
                    self.output.push(CHARS[(chunk[0] >> 2) as usize]);
                    self.output
                        .push(CHARS[((chunk[0] & 0x03) << 4) as usize]);
                    self.output.push(b'=');
                    self.output.push(b'=');
                }
                _ => {}
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_empty() {
        assert_eq!(base64_encode(""), "");
    }

    #[test]
    fn base64_f() {
        assert_eq!(base64_encode("f"), "Zg==");
    }

    #[test]
    fn base64_fo() {
        assert_eq!(base64_encode("fo"), "Zm8=");
    }

    #[test]
    fn base64_foo() {
        assert_eq!(base64_encode("foo"), "Zm9v");
    }

    #[test]
    fn base64_foob() {
        assert_eq!(base64_encode("foob"), "Zm9vYg==");
    }

    #[test]
    fn base64_fooba() {
        assert_eq!(base64_encode("fooba"), "Zm9vYmE=");
    }

    #[test]
    fn base64_foobar() {
        assert_eq!(base64_encode("foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_colon_prefix() {
        assert_eq!(base64_encode(":mytoken"), "Om15dG9rZW4=");
    }

    #[test]
    fn base64_special_chars() {
        assert_eq!(base64_encode("hello world!"), "aGVsbG8gd29ybGQh");
    }

    #[test]
    fn auth_header_with_pat() {
        let state = AppState::new();
        *state.pat.lock().unwrap() = Some("mytoken".to_string());
        let header = state.get_auth_header().unwrap();
        // ":mytoken" base64 = "Om15dG9rZW4="
        assert_eq!(header, "Basic Om15dG9rZW4=");
    }

    #[test]
    fn auth_header_without_pat() {
        let state = AppState::new();
        let result = state.get_auth_header();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PAT not configured");
    }

    #[test]
    fn get_config_without_config() {
        let state = AppState::new();
        let result = state.get_config();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "ADO not configured");
    }

    #[test]
    fn get_config_with_config() {
        let state = AppState::new();
        *state.config.lock().unwrap() = Some(AdoConfig {
            organization: "myorg".to_string(),
            project: "myproj".to_string(),
            area_path: "myarea".to_string(),
        });
        let config = state.get_config().unwrap();
        assert_eq!(config.organization, "myorg");
        assert_eq!(config.project, "myproj");
        assert_eq!(config.area_path, "myarea");
    }
}
