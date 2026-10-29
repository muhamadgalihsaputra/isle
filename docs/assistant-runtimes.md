# Isle Assistant Runtimes and External MCP

Isle's in-app assistant target is Hermes Agent and Oh My Pi (OMP). A separate
MCP server exposes Isle data and actions to AI agents running outside Isle.
The external agent connects using its own MCP settings; it is not another
provider in Isle's Assistant Settings. See the [platform plan](assistant-platform-plan.md)
and [implementation audit](assistant-platform-status.md).

## Hermes Agent inside Isle

The current adapter uses Hermes' local API server. In `~/.hermes/.env`, set
`API_SERVER_ENABLED=true` and a strong `API_SERVER_KEY`, then run
`hermes gateway`. Keep the API server bound to its default loopback address.
Isle reads the key from that file and connects to `http://127.0.0.1:8642/v1`.

Hermes keeps its own personality, memory, and native runtime behavior. Isle
adds its desktop instructions and executes Isle actions through Isle's action
loop. Live multi-step tool use and cancellation still need validation against
the installed Hermes version.

## Oh My Pi inside Isle

Install and configure `omp` with the provider and model you want. Select Oh My
Pi in Assistant Settings; the model is optional, and an empty field uses
OMP's configured default. Isle starts OMP in RPC mode, appends Isle
instructions, and stores the conversation under Isle's private data
directory.

Current source keeps OMP's native tools, extensions, skills, and rules. Isle
starts OMP with `--mode rpc-ui` so its native-tool approval requests can reach
Isle. OMP's `Allow tool: ...` approval dialog is shown through Isle's existing
agent permission alert, and Allow / Deny is sent back to OMP. If Isle cannot
show the alert or it is dismissed, Isle denies the request. Isle runs its OMP
session with `--approval-mode always-ask`: read-only tools can run, and
write/exec calls request approval. A session-only config overlay changes an
explicit `bash: allow` to `prompt`, while preserving `deny` rules. The user's
global OMP config is not edited. Other explicit per-tool policies stay in
effect, and other interactive extension dialogs are cancelled. Isle actions
requested in the in-app assistant use Isle's action path. Isle-managed
`SOUL.md`, `USER.md`, and `MEMORY.md` for OMP are part of the target but are
not implemented yet. OMP v18.12.5 is installed on the audited machine. A
direct prompt to its configured default returned text, and a one-prompt RPC
round trip emitted `ready`, opened a session, streamed text deltas, and ended
with `prompt_result` `completed`. A bash-only RPC check also executed a fixed
`printf` command, emitted OMP's tool start/end events, and returned the output.
This verifies the configured provider, RPC framing, and that native tools stay
enabled under the OMP permission settings; it does not verify a request
through `isled` and the GNOME UI. The full
`omp models` catalog took about 27 seconds to list, so Assistant Settings now
uses OMP's configured default or an optional manual `provider/model` ID instead
of fetching the entire catalog automatically.

The approval bridge uses OMP's `rpc-ui` event protocol and the same Isle alert
path used for Claude Code and Codex. The RPC event format was captured with a
temporary OMP bash prompt rule and a harmless `printf` command. The code path
and session-only approval policy are implemented, but the actual GNOME alert
click-through has not yet been verified in a live shell session.

## External AI agents through MCP

Use Isle's optional MCP server when an agent outside Isle needs Isle data or
actions. Configure the MCP endpoint and any required bearer token in that
agent's own MCP settings (for example, in Claude Code, Antigravity, or Codex).
Isle does not configure the external agent's model, provider, or API key.

The current server exposes only a selected set of tools. The target is to
expose all Isle data and actions, including useful filtered reads such as
calories for a requested date. See [MCP server setup and current coverage](mcp.md).

## Scope note

OpenAI-compatible BYOK and other coding-agent adapters exist in source, but
they are not target runtimes for the assistant built into Isle. Use the
existing external agent harness for those providers and connect it to Isle
through MCP when it needs Isle capabilities.
