# Assistant Platform Task List

Tasks follow dependency order. A task is complete when its acceptance criteria are met and its focused checks pass.

## 1. Specify interfaces and document runtime setup

- [x] Define the assistant adapter boundary for start, warm, prompt, stream, stop, and conversation continuation (see [assistant-adapter-boundary.md](assistant-adapter-boundary.md); the boundary is the `Brain` enum's contract, not a new trait — a trait refactor across five providers would churn code for no behavior gain).
- [x] Define MCP tool groups, permission categories, credential handling, and the daemon-to-MCP bridge.
- [x] Document setup and troubleshooting for Hermes, Oh My Pi, BYOK, and MCP clients.
- [x] Hermes/BYOK streaming and cancellation: API answers stream as SSE deltas into the draft view, and dropping the request (Cancel) stops the remote request instead of letting it run to completion in the background. Operational validation against live backends still pending (see 9).
- [ ] Finish Hermes/BYOK operational validation.

## 2. Hermes runtime

Depends on: 1.

- [x] Add Hermes as a selectable assistant backend, using its OpenAI-compatible local API.
- [x] Map streamed drafts, tool activity, errors, follow-ups, and cancellation to Isle's assistant state. API answers stream as SSE deltas into the draft view; cancelling drops the request and closes its connection.
- [x] Supply Isle-specific system instructions while preserving Hermes' own personality and memory files.
- [x] Keep Hermes conversation history across daemon restarts (private per-provider history file under the data directory).

Acceptance: a user can select Hermes, complete a multi-step desktop task, see progress, stop a run, and continue a conversation.

## 3. Coding-agent personality settings

Depends on: 1.

- [x] Add editable custom personality/instructions for supported coding-agent backends other than Hermes.
- [x] Pass the configured instructions through each backend's supported prompt mechanism.
- [x] Keep Hermes personality and memory files under Hermes' own management.

Acceptance: changing the custom instructions affects the next session on supported non-Hermes backends and does not alter Hermes identity or memory.

## 4. Isle MCP HTTP server

Depends on: 1.

- [x] Add a Python FastMCP HTTP server and package/install its runtime dependency.
- [x] Bridge MCP calls to a narrow Isle daemon interface; preserve existing caller restrictions.
- [x] Add configurable bind address, loopback default, network-bind authentication, and per-tool write allowlists.
- [x] Add independent per-client permission categories.
- [x] Expose the existing productivity operations with safe typed interfaces (tasks, calendar, reminders, focus timer, media, prayer, calories).
- [x] Expose URL opening through the desktop portal as a scoped typed operation.

Acceptance: a compatible MCP client can list and call permitted tools; unauthorized and disallowed calls fail closed and are auditable.

## 5. Oh My Pi runtime

Depends on: 1 and 3.

- [x] Add Oh My Pi as a selectable runtime over RPC.
- [x] Map streamed messages, tool events, approvals, cancellation, errors, and conversation continuation into Isle. OMP native tools stay disabled; Isle actions use its own approvals.
- [x] Apply custom coding-agent instructions using OMP's supported prompt/configuration interface.
- [ ] Fetch OMP's full model catalog for the settings picker via RPC `get_available_models` (values are `provider/id`, as the model entry documents). BLOCKED live: OMP v18.12.6 refuses the full catalog ("RPC response exceeded the transport limit") and its RPC protocol has no per-provider or chunked alternative, so the picker falls back to the default plus the free-text entry. Code and catalog parsing are implemented and unit-tested; the checkbox stays open until a live OMP returns a catalog.

Acceptance: OMP can complete the same desktop task flow as Hermes through Isle's existing action/approval surface.

Runtime acceptance still needs an installed OMP account and an interactive run; the focused local checks only compile the adapter and test catalog parsing.

## 6. Direct OpenAI-compatible BYOK

Depends on: 1.

- [x] Add secure API-key storage and endpoint/model configuration (`~/.config/isle/ai.env`, mode `0600`).
- [x] Discover models through `/models` or `/v1/models` and provide a model picker.
- [x] Feed selected model responses through Isle's existing agent loop and tool approval behavior.
- [x] Allow a custom system prompt for this agent mode.

Acceptance: a configured compatible endpoint can answer and use Isle tools without installing another agent runtime.

Runtime acceptance still needs a live compatible endpoint and key; model discovery and chat have not been exercised against a provider here.

## 7. Prayer times and reminders

Depends on: 4.

- [x] Add user-selected location and AlAdhan method 20 schedule retrieval.
- [x] Show upcoming prayer times and allow prayer reminders.
- [x] Expose schedule read and reminder configuration through MCP.

Acceptance: schedules reflect selected location and local time zone; enabled reminders fire at the configured prayer times.

## 8. Local calorie log

Depends on: 4.

- [x] Add local records for food description, calories, and time, with create/list/update/delete operations.
- [x] Add a simple Isle view for daily entries and calorie totals.
- [x] Expose the same scoped operations through MCP.

Acceptance: the user and authorized agents can manage entries, and records survive daemon restart.

## 9. Packaging and release documentation

Depends on: 2–8.

- [x] Include the MCP Python runtime and server in supported install/package flows.
- [ ] Document operational validation for Hermes and BYOK.
- [x] Document cancellation behavior for Hermes and BYOK (dropping the request stops the remote SSE stream and closes its connection).
- [x] Document custom instructions, MCP client configuration and permissions, prayer settings, and calorie data location.
- [x] Update product documentation and diagnostics to report configured/available backends and MCP server status without revealing secrets.

Acceptance: a fresh installation can set up each supported backend and connect a local MCP client using the documented steps.
