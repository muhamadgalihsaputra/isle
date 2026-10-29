# Isle Assistant Runtimes and External MCP

Isle's in-app assistant target is Hermes Agent and Oh My Pi (OMP). A separate
MCP server exposes Isle data and actions to AI agents running outside Isle.
The external agent connects using its own MCP settings; it is not another
provider in Isle's Assistant Settings. See the [platform plan](assistant-platform-plan.md)
and [implementation audit](assistant-platform-status.md).

## Hermes Agent inside Isle

Isle connects to Hermes' local API server; it does not start the `hermes`
program itself. Hermes must be installed, configured with a provider/model,
and running its gateway before Isle can send it a request.

### Set up the Hermes API

1. Install Hermes Agent and finish its provider setup using the
   [Hermes installation guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/installation.md).
2. Add these values to `~/.hermes/.env`:

   ```dotenv
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<paste-a-long-random-secret-here>
   ```

   Generate the key with `openssl rand -hex 32`; paste its output as the value
   of `API_SERVER_KEY`. Keep the file private by setting its mode to `0600`
   (`chmod 600 ~/.hermes/.env`). Keep Hermes on its default API address,
   `127.0.0.1:8642`. The API server exposes Hermes' full toolset, including
   terminal commands, and requires the key even on loopback. Do not bind it to
   `0.0.0.0` for Isle. See Hermes' [API server guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md)
   for its security and configuration details.
3. Start the gateway. To run it in the foreground:

   ```sh
   hermes gateway
   ```

   Its startup output should report the API server listening at
   `http://127.0.0.1:8642`. For a persistent user service, install it once
   with `hermes gateway install`, then use `hermes gateway start` and check
   it with `hermes gateway status` (see the Hermes
   [gateway command reference](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md)).
   Isle does not start or supervise Hermes.
4. Open **Isle Settings → Assistant**, enable the assistant, and choose
   **Hermes Agent**. The Model row offers **Hermes default** and IDs returned
   by Hermes' `/v1/models` endpoint. Choose an explicit listed ID if the
   default does not work with your Hermes version.

Isle reads `API_SERVER_KEY` from `~/.hermes/.env` (or `HERMES_API_KEY` from
the `isled` environment) and connects to
`http://127.0.0.1:8642/v1`. The optional `ISLE_HERMES_URL` environment
variable changes that URL for a gateway using a different local port; it is
not an Assistant Settings field. Isle has no separate Hermes key or endpoint
form because Hermes owns provider setup and credentials.

`isled --doctor` reports Hermes as configured when it finds the API key. That
check does not verify that the gateway is currently reachable. If Isle reports
an API connection error, check that `hermes gateway` is still running, that it
uses port 8642, and that the key in `~/.hermes/.env` matches the running
gateway.

### What Isle and Hermes each handle

Isle sends a streaming OpenAI-compatible Chat Completions request to Hermes,
with Isle's assistant instructions and the selected model. The response text
is parsed as Isle's answer format. Desktop actions in that answer use Isle's
own action and approval flow. Isle stores up to 60 recent conversation
messages in `~/.local/share/isle/assistant-history-hermes.json`, with
user-only file permissions, so the conversation can continue after a restart.
This uses Isle's default data directory; an XDG data-directory override moves
the file with it.

Hermes keeps its own identity, personality, memory, skills, and native tools.
Native Hermes tool calls run in the Hermes API server under Hermes' own tool
and approval settings. The current Isle adapter does not process API-side
native-tool approval requests or turn them into Isle Allow / Deny alerts;
configure and verify those permissions in Hermes. Isle's desktop-action
approval does not cover them. Isle also currently consumes text deltas only,
so Hermes tool-progress events are not shown as activity in Isle. Multi-step
tool use, default-model handling, and cancellation still need live acceptance
against the installed Hermes version.

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
