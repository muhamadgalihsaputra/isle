// SPDX-License-Identifier: GPL-3.0-or-later

//! OpenAI-compatible chat completions used for Hermes' local API and user-configured endpoints.

use anyhow::{Context, bail};
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;

use super::answer::{Answer, SCHEMA};

#[derive(Clone)]
pub struct Client {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub instructions: String,
    history: Vec<Value>,
    hermes_mode: bool,
}

impl Client {
    pub fn hermes(model: &str, instructions: &str) -> anyhow::Result<Self> {
        let home = dirs::home_dir().unwrap_or_default();
        let env = std::fs::read_to_string(home.join(".hermes/.env")).unwrap_or_default();
        let key = env
            .lines()
            .find_map(|line| {
                let (name, value) = line.trim().split_once('=')?;
                (name.trim() == "API_SERVER_KEY")
                    .then(|| value.trim().trim_matches(['\"', '\'']).to_owned())
            })
            .filter(|key| !key.is_empty())
            .or_else(|| std::env::var("HERMES_API_KEY").ok())
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Hermes API key not found; enable the Hermes API server and set API_SERVER_KEY"
                )
            })?;
        Ok(Self {
            base_url: std::env::var("ISLE_HERMES_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8642/v1".into()),
            api_key: key,
            model: model.to_owned(),
            instructions: instructions.to_owned(),
            history: Vec::new(),
            hermes_mode: true,
        })
    }

    pub fn hermes_configured() -> bool {
        let home = dirs::home_dir().unwrap_or_default();
        std::fs::read_to_string(home.join(".hermes/.env")).is_ok_and(|env| {
            env.lines().any(|line| {
                line.trim().split_once('=').is_some_and(|(name, value)| {
                    name.trim() == "API_SERVER_KEY"
                        && !value.trim().trim_matches(['\"', '\'']).is_empty()
                })
            })
        }) || std::env::var_os("HERMES_API_KEY").is_some()
    }

    pub fn byok(model: &str, instructions: &str) -> anyhow::Result<Self> {
        let base_url = config_value("ISLE_OPENAI_BASE_URL").ok_or_else(|| {
            anyhow::anyhow!(
                "Set ISLE_OPENAI_BASE_URL and ISLE_OPENAI_API_KEY in ~/.config/isle/ai.env"
            )
        })?;
        let api_key = config_value("ISLE_OPENAI_API_KEY")
            .ok_or_else(|| anyhow::anyhow!("ISLE_OPENAI_API_KEY is not configured"))?;
        Ok(Self {
            base_url,
            api_key,
            model: model.to_owned(),
            instructions: instructions.to_owned(),
            history: Vec::new(),
            hermes_mode: false,
        })
    }

    pub async fn ask(
        &mut self,
        prompt: &str,
        activity: Option<&UnboundedSender<String>>,
        draft: Option<&UnboundedSender<String>>,
    ) -> anyhow::Result<Answer> {
        let this = self.clone();
        let prompt = prompt.to_owned();
        let request_prompt = prompt.clone();
        let response =
            tokio::task::spawn_blocking(move || this.complete(&request_prompt)).await??;
        let content = response["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("API response has no assistant message"))?
            .to_owned();
        self.history.push(json!({"role":"user","content":prompt}));
        self.history
            .push(json!({"role":"assistant","content":content}));
        if self.history.len() > 60 {
            self.history.drain(..self.history.len() - 60);
        }
        if let Some(draft) = draft {
            draft.send(content.clone()).ok();
        }
        if let Some(activity) = activity {
            activity.send(String::new()).ok();
        }
        Ok(super::answer::from_text(&content))
    }

    fn complete(&self, prompt: &str) -> anyhow::Result<Value> {
        if self.hermes_mode {
            self.ensure_hermes_toolless()?;
        }
        let base = self.base_url.trim_end_matches('/');
        let url = if base.ends_with("/chat/completions") {
            vec![base.to_owned()]
        } else if base.ends_with("/v1") {
            vec![format!("{base}/chat/completions")]
        } else {
            vec![
                format!("{base}/chat/completions"),
                format!("{base}/v1/chat/completions"),
            ]
        };
        let system = format!(
            "{}\n\nReturn only JSON matching this schema: {}",
            self.instructions, SCHEMA
        );
        let mut messages = vec![json!({"role":"system","content":system})];
        messages.extend(self.history.iter().cloned());
        messages.push(json!({"role":"user","content":prompt}));
        let body = json!({"model": self.model, "stream": false,
            "messages": messages,
            "response_format":{"type":"json_object"}});
        let mut last_error = None;
        for url in url {
            match ureq::post(&url)
                .header("Authorization", &format!("Bearer {}", self.api_key))
                .header("Content-Type", "application/json")
                .send_json(body.clone())
                .and_then(|response| response.into_body().read_json::<Value>())
            {
                Ok(response) => return Ok(response),
                Err(error) => last_error = Some(error),
            }
        }
        Err(anyhow::anyhow!(
            "OpenAI-compatible API request failed: {}",
            last_error.unwrap()
        ))
    }

    fn ensure_hermes_toolless(&self) -> anyhow::Result<()> {
        let base = self.base_url.trim_end_matches('/');
        let root = base.strip_suffix("/v1").unwrap_or(base);
        let url = format!("{root}/v1/toolsets");
        let response: Value = ureq::get(&url)
            .header("Authorization", &format!("Bearer {}", self.api_key))
            .call()
            .context("could not verify Hermes API tool permissions")?
            .into_body()
            .read_json()
            .context("Hermes API did not return toolset status")?;
        let toolsets = response
            .as_array()
            .or_else(|| response["toolsets"].as_array())
            .ok_or_else(|| {
                anyhow::anyhow!("Hermes API toolset response is not recognized; refusing to run")
            })?;
        for set in toolsets.iter().filter(|set| set["enabled"] == true) {
            let name = set["name"]
                .as_str()
                .or_else(|| set["id"].as_str())
                .or_else(|| set["toolset"].as_str());
            let tools = set["tools"].as_array().ok_or_else(|| {
                anyhow::anyhow!(
                    "Hermes API returned an enabled toolset without its tool list; refusing to run"
                )
            })?;
            if !tools.is_empty() && name != Some("memory") {
                bail!(
                    "Hermes API has non-memory native tools enabled. Set platform_toolsets.api_server: [memory] in ~/.hermes/config.yaml so Isle remains the only executor of desktop actions."
                );
            }
        }
        Ok(())
    }

    pub fn models(&self) -> anyhow::Result<Vec<String>> {
        let base = self.base_url.trim_end_matches('/');
        let candidates = if base.ends_with("/v1") {
            vec![format!("{base}/models")]
        } else if base.ends_with("/models") {
            vec![base.to_owned()]
        } else {
            vec![format!("{base}/models"), format!("{base}/v1/models")]
        };
        let mut last_error = None;
        for url in candidates {
            match ureq::get(&url)
                .header("Authorization", &format!("Bearer {}", self.api_key))
                .call()
                .and_then(|response| response.into_body().read_json::<Value>())
            {
                Ok(body) => {
                    let list = body["data"]
                        .as_array()
                        .or_else(|| body["models"].as_array())
                        .ok_or_else(|| anyhow::anyhow!("models response has no data array"))?;
                    return Ok(list
                        .iter()
                        .filter_map(|item| item["id"].as_str().map(str::to_owned))
                        .collect());
                }
                Err(error) => last_error = Some(error),
            }
        }
        Err(anyhow::anyhow!(
            "models endpoint request failed: {}",
            last_error.unwrap()
        ))
    }
}

pub fn byok_configured() -> bool {
    config_value("ISLE_OPENAI_BASE_URL").is_some() && config_value("ISLE_OPENAI_API_KEY").is_some()
}

pub fn discover(provider: &str) -> anyhow::Result<Vec<String>> {
    let client = match provider {
        "hermes" => Client::hermes("", ""),
        "openai-compatible" => Client::byok("", ""),
        _ => bail!("model discovery is only available for API providers"),
    }?;
    client.models()
}

fn config_value(name: &str) -> Option<String> {
    if let Ok(value) = std::env::var(name) {
        if !value.is_empty() {
            return Some(value);
        }
    }
    let path = dirs::config_dir()?.join("isle/ai.env");
    let metadata = std::fs::metadata(&path).ok()?;
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o077 != 0 {
        return None;
    }
    std::fs::read_to_string(path)
        .ok()?
        .lines()
        .find_map(|line| {
            let (key, value) = line.trim().split_once('=')?;
            (key.trim() == name).then(|| value.trim().trim_matches(['\"', '\'']).to_owned())
        })
        .filter(|value| !value.is_empty())
}
