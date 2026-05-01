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
