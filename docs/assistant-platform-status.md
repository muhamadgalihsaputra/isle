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

## Still incomplete

- Hermes and BYOK API replies are not streamed into Isle's draft view. Cancelling an Isle request does not stop a request already executing on the remote API server.
- Hermes and BYOK conversation state is held in memory for the daemon process; durable continuation after an `isled` restart is not implemented.
- OMP's full model catalog is not fetched; the user can use OMP's configured default or enter a model id. Its RPC adapter has not been exercised with an installed OMP runtime.
- The common adapter boundary does not yet expose a formal stream and stop interface across every provider.
- The MCP server, token scopes, network bind, portal URL opening, and external API backends have not been exercised against live services in this workspace.

## Local checks completed

- `cargo fmt --check`
- `cargo check --offline -p isle-daemon`
- `glib-compile-schemas --strict --dry-run gnome-extension/schemas`
- `node --check` for the changed preferences and voice JavaScript
- Python AST parse for `mcp/server.py`
- `git diff --check`

These checks do not replace live Hermes, OMP, OpenAI-compatible API, MCP client, or desktop-portal verification.
