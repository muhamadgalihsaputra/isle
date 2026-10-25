// SPDX-License-Identifier: GPL-3.0-or-later

//! Oh My Pi's newline-delimited RPC runtime. OMP's native tools are disabled so Isle remains the executor.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, bail};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::mpsc::UnboundedSender;

use super::answer::Answer;
use super::child::{self, Events, Group};

static NEXT: AtomicU64 = AtomicU64::new(1);

pub struct Omp {
    _child: Group,
    stdin: ChildStdin,
    events: Events<ChildStdout>,
    session_dir: PathBuf,
    request: u64,
}

impl Omp {
    pub async fn start(
        program: &Path,
        model: &str,
        resume: Option<&str>,
        workspace: &Path,
        instructions: &str,
    ) -> anyhow::Result<Self> {
        std::fs::create_dir_all(workspace)?;
        let session_dir = resume
            .map(PathBuf::from)
            .filter(|path| {
                path.is_dir()
                    && path.starts_with(workspace)
                    && path
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with("omp-"))
            })
            .unwrap_or_else(|| {
                let id = NEXT.fetch_add(1, Ordering::Relaxed);
                workspace.join(format!("omp-{}-{id}", std::process::id()))
            });
        std::fs::create_dir_all(&session_dir)?;
        let mut command = Command::new(program);
        command
            .args([
                "--mode",
                "rpc",
                "--no-ui",
                "--no-tools",
                "--no-extensions",
                "--no-skills",
                "--no-rules",
                "--append-system-prompt",
                instructions,
                "--session-dir",
            ])
            .arg(&session_dir);
        if !model.is_empty() {
            command.args(["--model", model]);
        }
        command
            .current_dir(workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child =
            child::spawn(&mut command).context("could not start omp; is Oh My Pi installed?")?;
        let stdin = child.stdin.take().expect("piped stdin");
        let events = Events::new(child.stdout.take().expect("piped stdout"));
        let mut this = Self {
            _child: child,
            stdin,
            events,
            session_dir,
            request: 1,
        };
        this.wait_ready().await?;
        let response = this
            .command(json!({"type":"open_session", "sessionDir":this.session_dir}))
            .await?;
        if response["success"] != true {
            bail!(
                "Oh My Pi could not open its conversation: {}",
                response["error"].as_str().unwrap_or("unknown error")
            );
        }
        Ok(this)
    }

    async fn wait_ready(&mut self) -> anyhow::Result<()> {
        loop {
            let event = self.next().await?;
            if event["type"] == "ready" {
                return Ok(());
            }
            if event["type"] == "notice" {
                bail!(
                    "Oh My Pi failed to start: {}",
                    event["message"].as_str().unwrap_or("unknown error")
                );
            }
        }
    }

    async fn command(&mut self, mut command: Value) -> anyhow::Result<Value> {
        let id = format!("isle-{}", self.request);
        self.request += 1;
        command["id"] = json!(id);
        self.stdin
            .write_all(format!("{}\n", command).as_bytes())
            .await
            .context("could not write to Oh My Pi")?;
        loop {
            let event = self.next().await?;
            if event["type"] == "response" && event["id"] == id {
                return Ok(event);
            }
        }
    }

    async fn next(&mut self) -> anyhow::Result<Value> {
        self.events
            .next(&["\"type\""])
            .await?
            .ok_or_else(|| anyhow::anyhow!("Oh My Pi closed its RPC stream"))
    }

    pub async fn warm(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    pub async fn ask(
        &mut self,
        prompt: &str,
        activity: Option<&UnboundedSender<String>>,
        draft: Option<&UnboundedSender<String>>,
    ) -> anyhow::Result<Answer> {
        let id = format!("isle-prompt-{}", self.request);
        self.request += 1;
        let frame = json!({"id":id, "type":"prompt", "message":prompt});
        self.stdin
            .write_all(format!("{frame}\n").as_bytes())
            .await
            .context("could not write to Oh My Pi")?;
        let mut output = String::new();
        let mut assistant_end = String::new();
        loop {
            let event = self.next().await?;
            match event["type"].as_str().unwrap_or_default() {
                "message_update" => {
                    let update = &event["assistantMessageEvent"];
                    if let Some(delta) = update["delta"]
                        .as_str()
                        .filter(|_| update["type"] == "text_delta")
                    {
                        output.push_str(delta);
                        if let Some(draft) = draft {
                            draft.send(output.clone()).ok();
                        }
                    }
                }
                "message_end" => {
                    if event["message"]["role"] == "assistant" {
                        let text = message_text(&event["message"]);
                        if !text.is_empty() {
                            assistant_end = text;
                        }
                    }
                }
                "tool_execution_start" => {
                    if let Some(activity) = activity {
                        let name = event["toolName"].as_str().unwrap_or("tool");
                        activity.send(format!("Oh My Pi is using {name}…")).ok();
                    }
                }
                "prompt_result" if event["id"] == id => {
                    if event["status"] != "completed" {
                        bail!(
                            "Oh My Pi prompt {}: {}",
                            event["status"].as_str().unwrap_or("failed"),
                            event["error"]["message"].as_str().unwrap_or("no details")
                        );
                    }
                    let text = if assistant_end.is_empty() {
                        output
                    } else {
                        assistant_end
                    };
                    if text.trim().is_empty() {
                        bail!("Oh My Pi returned no answer");
                    }
                    if let Some(draft) = draft {
                        draft.send(String::new()).ok();
                    }
                    return Ok(super::answer::from_text(&text));
                }
                "extension_ui_request" | "host_tool_call" | "host_uri_request" => {
                    bail!(
                        "Oh My Pi requested a native tool while Isle tools are disabled; stopped for safety"
                    );
                }
                _ => {}
            }
        }
    }

    pub fn conversation(&self) -> Option<String> {
        Some(self.session_dir.to_string_lossy().into_owned())
    }

    pub fn forget(id: &str) {
        let path = PathBuf::from(id);
        let owned = crate::store::data_dir().join("assistant");
        if !path.starts_with(owned)
            || !path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("omp-"))
        {
            return;
        }
        let _ = std::fs::remove_dir_all(path);
    }
}

fn message_text(message: &Value) -> String {
    match &message["content"] {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect(),
        _ => String::new(),
    }
}
