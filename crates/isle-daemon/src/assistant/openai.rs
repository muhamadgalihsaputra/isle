// SPDX-License-Identifier: GPL-3.0-or-later

//! OpenAI-compatible chat completions used for Hermes' local API and user-configured endpoints.
//!
//! Unlike the first version of this client, which waited for the whole reply,
//! answers stream: each server-sent delta is forwarded to the draft view as it
//! arrives, and the full text is parsed into an [`Answer`] only once complete.
//! Cancelling works the same way the rest of the assistant cancels: dropping
//! the [`Client::ask`] future (see `until_cancelled`) drops a guard that sets
//! a flag the streaming reader checks between lines, so the request stops and
//! its connection closes instead of running to completion in the background.
//! A stalled server mid-stream still blocks one reader thread until the
//! server sends more or the connection dies; there is no per-read timeout
//! because a total body budget would also cut off legitimately long answers.

use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, bail};
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;

use super::answer::{Answer, SCHEMA};

/// Sets the shared cancel flag when dropped: the streaming reader in the
/// blocking task checks it between lines, so dropping the `ask` future
/// (the assistant's cancel path) stops the remote request.
struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

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
            history: load_history("hermes"),
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
            history: load_history("openai"),
            hermes_mode: false,
        })
    }

    pub async fn ask(
        &mut self,
        prompt: &str,
        activity: Option<&UnboundedSender<String>>,
        draft: Option<&UnboundedSender<String>>,
    ) -> anyhow::Result<Answer> {
        // Held by this future: dropping it (cancel) sets the flag the
        // streaming reader checks, so the remote request stops.
        let cancel = Arc::new(AtomicBool::new(false));
        let _cancel_guard = CancelOnDrop(cancel.clone());
        // The blocking reader answers Hermes' approval requests through the
        // island's alert flow, which is async: it runs on this runtime.
        let handle = tokio::runtime::Handle::current();
        let this = self.clone();
        let prompt = prompt.to_owned();
        let request_prompt = prompt.clone();
        let draft_tx = draft.cloned();
        let activity_tx = activity.cloned();
        let content = tokio::task::spawn_blocking(move || {
            this.stream_complete(&request_prompt, activity_tx.as_ref(), draft_tx.as_ref(), &cancel, &handle)
        })
        .await??;
        self.history.push(json!({"role":"user","content":prompt}));
        self.history
            .push(json!({"role":"assistant","content":content}));
        if self.history.len() > 60 {
            self.history.drain(..self.history.len() - 60);
        }
        self.save_history();
        if let Some(draft) = draft {
            draft.send(String::new()).ok();
        }
        if let Some(activity) = activity {
            activity.send(String::new()).ok();
        }
        Ok(super::answer::from_text(&content))
    }

    fn save_history(&self) {
        let kind = if self.hermes_mode { "hermes" } else { "openai" };
        let path = history_path(kind);
        if crate::store::create_private_dir(&crate::store::data_dir()).is_ok() {
            if let Ok(text) = serde_json::to_string(&self.history) {
                let _ = crate::store::write_private(&path, text.as_bytes());
            }
        }
    }

    /// One named SSE event from the stream. Hermes tells the client what its
    /// tools are doing (`hermes.tool.progress`) and asks for approval of a
    /// flagged command (`approval.request`); other providers send none, and
    /// unknown names are ignored. Runs inside the blocking reader, so the
    /// approval waits on `handle` (see [`Self::send_hermes_approval`]).
    fn on_event(
        &self,
        name: &str,
        event: &Value,
        activity: Option<&UnboundedSender<String>>,
        handle: &tokio::runtime::Handle,
    ) {
        if !self.hermes_mode {
            return;
        }
        match name {
            "hermes.tool.progress" => {
                if event["status"] != "running" {
                    return;
                }
                let label = event["label"]
                    .as_str()
                    .filter(|label| !label.is_empty())
                    .or_else(|| event["tool"].as_str())
                    .unwrap_or("a tool");
                if let Some(activity) = activity {
                    activity.send(format!("Hermes is using {label}…")).ok();
                }
            }
            "approval.request" => {
                let request = hermes_approval(event);
                // `decide` waits for the island's answer for as long as the
                // alert does, and fails closed on its own when it must.
                let decision = handle.block_on(crate::agents::hook::decide(&request));
                let choice = match decision {
                    Ok(answer) if matches!(answer.as_str(), "allow" | "always") => {
                        if answer == "always" && event["allow_permanent"] != false {
                            "always"
                        } else {
                            "once"
                        }
                    }
                    _ => "deny",
                };
                if let Err(error) = self.send_hermes_approval(event, choice) {
                    log::warn!("could not answer Hermes' approval request: {error:#}");
                }
            }
            _ => {}
        }
    }

    /// Posts the user's `choice` for `event` back to Hermes, so its waiting
    /// tool goes on (`once`), keeps for the session (`session`) or is refused
    /// (`deny`).
    fn send_hermes_approval(&self, event: &Value, choice: &str) -> anyhow::Result<()> {
        let Some(run) = event["run_id"].as_str().filter(|id| !id.is_empty()) else {
            bail!("approval request has no run id");
        };
        let base = self.base_url.trim_end_matches('/');
        let root = base
            .strip_suffix("/chat/completions")
            .or_else(|| base.strip_suffix("/v1"))
            .unwrap_or(base);
        let url = format!("{root}/v1/runs/{run}/approval");
        ureq::post(&url)
            .header("Authorization", &format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .send_json(json!({"choice": choice}))
            .map(|_| ())
            .map_err(anyhow::Error::from)
    }

    /// Streams one chat completion, forwarding each text delta to the draft
    /// view as it arrives. Runs on a blocking thread: the response body is a
    /// synchronous reader, and the caller's cancel flag is checked between
    /// lines. Returns the full accumulated text; parsing into an [`Answer`]
    /// happens in [`Client::ask`] once complete. Hermes' named events ride the
    /// same stream: `hermes.tool.progress` becomes activity in the island, and
    /// an `approval.request` is answered through the island's Allow / Deny
    /// alert and sent back to Hermes' runs API (`handle` runs that waiting).
    fn stream_complete(
        &self,
        prompt: &str,
        activity: Option<&UnboundedSender<String>>,
        draft: Option<&UnboundedSender<String>>,
        cancel: &AtomicBool,
        handle: &tokio::runtime::Handle,
    ) -> anyhow::Result<String> {
        let base = self.base_url.trim_end_matches('/');
        let urls = if base.ends_with("/chat/completions") {
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
        let body = json!({"model": self.model, "stream": true,
            "messages": messages,
            "response_format":{"type":"json_object"}});
        let mut last_error = None;
        for url in urls {
            match ureq::post(&url)
                .header("Authorization", &format!("Bearer {}", self.api_key))
                .header("Content-Type", "application/json")
                .send_json(body.clone())
            {
                Ok(response) => {
                    let reader = response.into_body().into_reader();
                    let this = self.clone();
                    let handle = handle.clone();
                    let draft_tx = draft.cloned();
                    let activity_tx = activity.cloned();
                    let accumulated = accumulate_sse(
                        BufReader::new(reader),
                        cancel,
                        move |text| {
                            if let Some(draft) = draft_tx.as_ref() {
                                draft.send(text.to_owned()).ok();
                            }
                        },
                        move |name, event| {
                            this.on_event(name, event, activity_tx.as_ref(), &handle);
                        },
                    )?;
                    if accumulated.trim().is_empty() {
                        bail!("API returned no answer");
                    }
                    return Ok(accumulated);
                }
                Err(error) => last_error = Some(error),
            }
        }
        Err(anyhow::anyhow!(
            "OpenAI-compatible API request failed: {}",
            last_error.unwrap()
        ))
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

/// Reads one server-sent-events stream, appending each
/// `choices[0].delta.content` to the accumulated text and calling `on_delta`
/// with the whole text after every delta, so the draft view updates live.
/// Lines that name an event (`event: hermes.tool.progress`, `event:
/// approval.request`) are handed to `on_event` instead. Stops at `data:
/// [DONE]` or end of stream; a data line that is not valid JSON fails, so a
/// provider that does not speak SSE surfaces at once instead of producing a
/// garbled reply. `cancel` is checked between lines: a set flag aborts the
/// read and drops the connection.
fn accumulate_sse<R: BufRead>(
    reader: R,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str),
    mut on_event: impl FnMut(&str, &Value),
) -> anyhow::Result<String> {
    let mut accumulated = String::new();
    let mut event_name = String::new();
    for line in reader.lines() {
        if cancel.load(Ordering::SeqCst) {
            bail!("request cancelled");
        }
        let line = line.context("could not read streamed reply")?;
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            event_name.clear();
            continue;
        }
        if let Some(name) = line.strip_prefix("event:") {
            event_name = name.trim().to_owned();
            continue;
        }
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            break;
        }
        let event: Value = serde_json::from_str(data)
            .with_context(|| format!("streamed reply is not valid SSE JSON: {data}"))?;
        if !event_name.is_empty() {
            on_event(&event_name, &event);
            event_name.clear();
            continue;
        }
        if let Some(delta) = event["choices"][0]["delta"]["content"].as_str() {
            if !delta.is_empty() {
                accumulated.push_str(delta);
                on_delta(&accumulated);
            }
        }
    }
    if cancel.load(Ordering::SeqCst) {
        bail!("request cancelled");
    }
    Ok(accumulated)
}

/// Hermes' `approval.request` as the island asks it: the flagged command with
/// its description, `always` only where Hermes offers to keep the rule.
fn hermes_approval(event: &Value) -> crate::agents::Request {
    crate::agents::Request {
        provider: "hermes".into(),
        session: event["session_id"].as_str().unwrap_or_default().into(),
        tool: event["description"].as_str().unwrap_or("a command").into(),
        input: event["command"].as_str().unwrap_or_default().into(),
        always: event["allow_permanent"] != false,
        ..crate::agents::Request::default()
    }
}

/// Conversation history for one API provider, kept across daemon restarts so
/// a conversation continues instead of starting over. Best effort: a missing
/// or malformed file just means starting fresh, and a failed save never fails
/// the answer it belongs to. The file holds user prompts, so it lives under
/// the private data directory with mode 0600 (see `store`).
fn history_path(kind: &str) -> std::path::PathBuf {
    crate::store::data_dir().join(format!("assistant-history-{kind}.json"))
}

fn load_history(kind: &str) -> Vec<Value> {
    let Ok(text) = std::fs::read_to_string(history_path(kind)) else {
        return Vec::new();
    };
    let Ok(Value::Array(items)) = serde_json::from_str(&text) else {
        return Vec::new();
    };
    let mut history: Vec<Value> = items
        .into_iter()
        .filter(|item| item["role"].is_string() && item["content"].is_string())
        .collect();
    if history.len() > 60 {
        history.drain(..history.len() - 60);
    }
    history
}

pub fn byok_configured() -> bool {
    config_value("ISLE_OPENAI_BASE_URL").is_some() && config_value("ISLE_OPENAI_API_KEY").is_some()
}

pub fn discover(provider: &str) -> anyhow::Result<Vec<String>> {
    if provider == "oh-my-pi" {
        return discover_omp_models();
    }
    let client = match provider {
        "hermes" => Client::hermes("", ""),
        "openai-compatible" => Client::byok("", ""),
        _ => bail!("model discovery is only available for API providers"),
    }?;
    client.models()
}

/// Lists OMP's catalog through a throwaway RPC session: the same startup
/// path the assistant itself uses, dropped (and its session dir removed)
/// once the catalog is read. Runs on its own thread-local runtime because
/// discovery is called from blocking code (the ListModels D-Bus method).
/// A failure here only empties the picker; the free-text model entry still
/// accepts a provider/model id by hand.
fn discover_omp_models() -> anyhow::Result<Vec<String>> {
    let program = super::brain::Provider::OhMyPi
        .program()
        .ok_or_else(|| anyhow::anyhow!("Oh My Pi is not installed"))?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("could not start a runtime for OMP model discovery")?;
    runtime.block_on(async move {
        let workspace = crate::store::data_dir().join("assistant");
        let mut omp = super::omp::Omp::start(&program, "", None, &workspace, "").await?;
        let models = omp.models().await;
        let dir = omp.conversation();
        drop(omp);
        if let Some(dir) = dir {
            super::omp::Omp::forget(&dir);
        }
        models
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn streamed(text: &str) -> String {
        let cancel = AtomicBool::new(false);
        let mut drafts = Vec::new();
        let out = accumulate_sse(
            Cursor::new(text),
            &cancel,
            |draft| drafts.push(draft.to_owned()),
            |_, _| {},
        )
        .unwrap();
        assert_eq!(drafts.last().map(String::as_str), Some(out.as_str()));
        out
    }

    #[test]
    fn sse_deltas_accumulate_and_done_stops() {
        let out = streamed(
            "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"say\\\": \"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\
             : keep-alive\n\
             data: [DONE]\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"ignored\"}}]}\n",
        );
        assert_eq!(out, "{\"say\": hi");
    }

    #[test]
    fn sse_ignores_lines_without_content() {
        let out = streamed(
            "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n",
        );
        assert_eq!(out, "ok");
    }

    #[test]
    fn sse_bad_json_fails() {
        let cancel = AtomicBool::new(false);
        let err = accumulate_sse(Cursor::new("data: not json\n"), &cancel, |_| {}, |_, _| {})
            .unwrap_err();
        assert!(err.to_string().contains("not valid SSE JSON"));
    }

    #[test]
    fn sse_cancelled_flag_aborts() {
        let cancel = AtomicBool::new(true);
        let err = accumulate_sse(
            Cursor::new("data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n"),
            &cancel,
            |_| {},
            |_, _| {},
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "request cancelled");
    }

    #[test]
    fn sse_named_events_reach_on_event_and_not_the_text() {
        let cancel = AtomicBool::new(false);
        let mut names = Vec::new();
        let out = accumulate_sse(
            Cursor::new(
                "event: hermes.tool.progress\n\
                 data: {\"tool\":\"terminal\",\"label\":\"Running ls\",\"status\":\"running\"}\n\n\
                 data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\
                 event: approval.request\n\
                 data: {\"command\":\"rm -rf /\",\"run_id\":\"chatcmpl-1\"}\n\n",
            ),
            &cancel,
            |_| {},
            |name, _event| names.push(name.to_owned()),
        )
        .unwrap();
        assert_eq!(out, "hi");
        assert_eq!(names, ["hermes.tool.progress", "approval.request"]);
    }

    #[test]
    fn hermes_approval_maps_fields() {
        let request = hermes_approval(&serde_json::from_str(
            "{\"command\":\"sudo apt install vlc\",\"description\":\"installs software\",\n             \"session_id\":\"chatcmpl-9\",\"allow_permanent\":true}",
        )
        .unwrap());
        assert_eq!(request.provider, "hermes");
        assert_eq!(request.tool, "installs software");
        assert_eq!(request.input, "sudo apt install vlc");
        assert_eq!(request.session, "chatcmpl-9");
        assert!(request.always);
    }
}
