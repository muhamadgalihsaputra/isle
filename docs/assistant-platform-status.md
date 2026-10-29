# Isle Assistant and MCP: Implementation Audit

Audited 2026-10-29 against [assistant-platform-plan.md](assistant-platform-plan.md).
The in-app assistant and the external MCP server have different jobs and are
tracked separately here. A provider or tool existing in source does not mean
its user-facing flow is complete.

## In-app assistant: source that exists

- Provider selection and backend dispatch currently include Hermes, Oh My Pi
  (OMP), OpenAI-compatible BYOK, and other coding-agent CLIs. The target for
  the Isle assistant is Hermes and OMP; BYOK and the other provider adapters
  are existing source, not required work for this target.
- Hermes uses a loopback OpenAI-compatible client and reads its API-server
  key from Hermes' configuration. Hermes owns its identity, personality, and
  durable memory. Isle also keeps an API conversation transcript.
- OMP has an RPC adapter, streaming/progress handling, session persistence,
  and model-catalog lookup code. Current source keeps OMP's native tools,
  extensions, skills, and rules.
- The installed OMP CLI is v18.12.5. A minimal prompt to OMP's configured
  default returned the expected text after about 57 seconds. A separate
  one-prompt RPC run emitted `ready`, opened a session, streamed text deltas,
  and ended with `prompt_result` `completed` after about 53 seconds. This
  verifies the configured provider and RPC framing used by Isle; the request
  has not yet been exercised through `isled` and the GNOME UI.
- Running `omp models` locally took about 27 seconds. Settings no longer
  requests OMP's entire catalog synchronously; it offers OMP's configured
  default and an optional manual model ID.
- Isle's current doctor check only confirms that the OMP executable exists;
  OMP owns credentials for its many provider options. The source now reports
  that OMP manages provider setup instead of claiming the binary is signed in.
- Isle currently starts OMP with `--no-ui`. OMP documents that tools needing
  interactive approval fail closed in this mode; the Isle adapter does not
  yet surface that approval flow.
- The in-app assistant has an Isle answer/action loop that executes Isle
  actions. The assistant does not use the external MCP server as its internal
  tool interface.
- Assistant Settings can select providers and models, enter a model ID, and
  edit one Custom instructions value. It does not manage OMP's
  `SOUL.md`, `USER.md`, or `MEMORY.md` files.

## External MCP server: source that exists

- A separate optional FastMCP HTTP service exposes a selected set of Isle
  tools to external MCP clients. This is the MCP integration for agents
  outside Isle; the external agent is configured in its own MCP settings.
- The current service has loopback defaults, per-client scopes, and write
  allowlists.
- Current MCP tools cover tasks, Isle calendar events, reminders, calorie
  entries, prayer schedule/location, current media controls, focus state and
  controls, and opening HTTP(S) URLs through the desktop portal.
- This selected set does not cover all Isle data and actions. For example,
  the Water D-Bus service has no MCP tools; clipboard/shelf contents,
  notifications, calls, and other Isle capabilities are also outside the
  current tool list. Date-filtered calorie reads are not yet accepted as a
  complete end-to-end external-agent flow.

## Remaining gaps against the target

- **MCP coverage and queries:** inventory all Isle features and expose them
  through external MCP tools. Include useful structured reads, such as getting
  calories for a specified date or date range, alongside writes and controls.
- **External client setup:** document the MCP endpoint and credentials for
  external clients. Their MCP configuration belongs in Claude Code,
  Antigravity, Codex, or the relevant agent harness, not in Isle's assistant
  provider settings.
- **OMP acceptance:** verify an in-app model response, Isle action execution,
  continuation, cancellation, and failures. Decide how to surface native OMP
  tool approvals without enabling auto-approval.
- **Hermes acceptance:** verify multi-step in-app requests, Isle action
  execution, continuation, cancellation, and errors against the local API.
- **OMP context:** add Isle-managed `SOUL.md`, `USER.md`, and `MEMORY.md` for
  OMP. Keep Hermes' own personality and memory intact.

Direct OpenAI-compatible BYOK fields in Isle Assistant Settings and an
internal MCP tool-call path are not target requirements. Existing BYOK source
is available for review, but external agents should use their own harness and
connect to Isle through the MCP server.

See [assistant-platform-tasks.md](assistant-platform-tasks.md) for remaining
work and acceptance criteria. No live provider or external MCP-client
acceptance was performed in this audit.
