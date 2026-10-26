# Assistant platform implementation status

Updated 2026-10-25.

This records what is implemented in the current workspace and what still needs engineering or live-service verification. The ordered checklist is in [assistant-platform-tasks.md](assistant-platform-tasks.md); runtime setup is in [assistant-runtimes.md](assistant-runtimes.md), and MCP setup is in [mcp.md](mcp.md).

## Implemented in the workspace

- Added a Hermes Agent provider using Hermes' loopback OpenAI-compatible API. Isle supplies its desktop-action instructions and checks `/v1/toolsets` before each answer. The API must be configured with only its `memory` toolset so Hermes can keep its own memory while Isle stays responsible for desktop actions.
- Added Oh My Pi as a selectable RPC provider. Isle disables OMP's built-in tools, appends Isle's action instructions, forwards message drafts and tool progress, and stores OMP sessions below Isle's private data directory.
- Added an OpenAI-compatible BYOK provider. It reads the endpoint and key from `~/.config/isle/ai.env` (mode `0600`) or the corresponding service environment variables, discovers models from `/models` or `/v1/models`, and exposes a model picker and custom instructions.
- Added per-client MCP scopes, write-tool allowlists, auditable calls, and typed Isle tools for tasks, calendar, reminders, focus timer, media, prayer, calories, plus portal-based URL opening.
- Added prayer schedules and reminders and a local calorie log, with Isle views and MCP operations.
- Added setup guides, package integration, and `isled --doctor` reporting for MCP service state and configured assistant providers.
- Hermes and BYOK answers stream: the OpenAI-compatible client requests SSE, forwards each text delta to the draft view, and parses the full JSON answer only once complete. Cancelling drops the request and closes its connection instead of letting it run to completion in the background.
- Hermes and BYOK conversation history survives daemon restarts: per-provider history files under the private data directory (mode 0600), loaded when the client is built and saved after each completed turn.

## Still incomplete

- OMP's full model catalog is not fetched; the user can use OMP's configured default or enter a model id. Its RPC adapter has not been exercised with an installed OMP runtime.
- The common adapter boundary does not yet expose a formal stream and stop interface across every provider.
- The MCP server, token scopes, network bind, portal URL opening, and external API backends have not been exercised against live services in this workspace.
- A server that stalls mid-stream still blocks one reader thread until it sends more or the connection dies; there is no per-read timeout, because a total body budget would also cut off legitimately long answers.

## Local checks completed

- `cargo fmt --check`
- `cargo check -p isle-daemon`
- `cargo test -p isle-daemon openai` (SSE accumulation, `[DONE]` stop, malformed JSON, cancel flag)
- `glib-compile-schemas --strict --dry-run gnome-extension/schemas`
- `node --check` for the changed preferences and voice JavaScript
- Python AST parse for `mcp/server.py`
- `git diff --check`

These checks do not replace live Hermes, OMP, OpenAI-compatible API, MCP client, or desktop-portal verification.
