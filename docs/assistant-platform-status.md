# Assistant platform implementation status

Updated 2026-10-25.

This records what is implemented in the current workspace and what still needs engineering or live-service verification. The ordered checklist is in [assistant-platform-tasks.md](assistant-platform-tasks.md); runtime setup is in [assistant-runtimes.md](assistant-runtimes.md), and MCP setup is in [mcp.md](mcp.md).

## Implemented in the workspace

- Added a Hermes Agent provider using Hermes' loopback OpenAI-compatible API. Hermes connects with full access: Isle supplies its desktop-action instructions and context, Hermes answers as Isle's agent, and Isle runs the desktop actions it asks for.
- Added Oh My Pi as a selectable RPC provider. Isle disables OMP's built-in tools, appends Isle's action instructions, forwards message drafts and tool progress, and stores OMP sessions below Isle's private data directory.
- Added an OpenAI-compatible BYOK provider. It reads the endpoint and key from `~/.config/isle/ai.env` (mode `0600`) or the corresponding service environment variables, discovers models from `/models` or `/v1/models`, and exposes a model picker and custom instructions.
- Added per-client MCP scopes, write-tool allowlists, auditable calls, and typed Isle tools for tasks, calendar, reminders, focus timer, media, prayer, calories, plus portal-based URL opening.
- Added prayer schedules and reminders and a local calorie log, with Isle views and MCP operations.
- Added setup guides, package integration, and `isled --doctor` reporting for MCP service state and configured assistant providers.
- Hermes and BYOK answers stream: the OpenAI-compatible client requests SSE, forwards each text delta to the draft view, and parses the full JSON answer only once complete. Cancelling drops the request and closes its connection instead of letting it run to completion in the background.
- Hermes and BYOK conversation history survives daemon restarts: per-provider history files under the private data directory (mode 0600), loaded when the client is built and saved after each completed turn.
- OMP's model catalog reaches the settings picker in code: the daemon lists it over RPC `get_available_models` through a throwaway session, and the picker shows `provider/id` values beside OMP's default. Live-blocked: OMP v18.12.6 refuses the full catalog ("RPC response exceeded the transport limit") and its RPC protocol offers no chunked alternative, so against a real OMP install the picker falls back to the default plus the free-text entry.
- The adapter boundary is defined in [assistant-adapter-boundary.md](assistant-adapter-boundary.md): the six operations every provider honors, how stop works (drop the ask future, then drop the brain), and how each provider continues a conversation.

## Still incomplete

- OMP's model catalog is live-blocked: OMP v18.12.6 refuses `get_available_models` ("RPC response exceeded the transport limit") and its RPC protocol has no chunked alternative, so the picker falls back to the default plus the free-text entry.
- The common adapter boundary does not yet expose a formal stream and stop interface across every provider.
- The MCP server, token scopes, network bind, portal URL opening, and external API backends have not been exercised against live services in this workspace.
- A server that stalls mid-stream still blocks one reader thread until it sends more or the connection dies; there is no per-read timeout, because a total body budget would also cut off legitimately long answers.

## Local checks completed

- `cargo fmt --check`
- `cargo check -p isle-daemon`
- `cargo test -p isle-daemon openai` (SSE accumulation, `[DONE]` stop, malformed JSON, cancel flag)
- `cargo test -p isle-daemon omp` (wire catalog parsing, bare array, unknown shapes)
- `glib-compile-schemas --strict --dry-run gnome-extension/schemas`
- `node --check` for the changed preferences and voice JavaScript
- Python AST parse for `mcp/server.py`
- `git diff --check`

These checks do not replace live Hermes, OMP, OpenAI-compatible API, MCP client, or desktop-portal verification.
