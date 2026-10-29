# Assistant Platform: Implementation Audit

Audited 2026-10-29 against the target in [assistant-platform-plan.md](assistant-platform-plan.md).
This document separates source code that exists from end-to-end acceptance. A
provider appearing in Settings or a checklist item being implemented in source
does not mean the user-facing runtime is complete.

## Source that exists

- The assistant has provider selection and backend dispatch for Hermes, Oh My
  Pi, OpenAI-compatible BYOK, and the existing coding-agent CLIs.
- Hermes uses a loopback OpenAI-compatible client and reads its API-server key
  from Hermes' configuration. Hermes owns its personality and durable memory;
  Isle also keeps an API conversation transcript for continuation.
- OMP has an RPC adapter, streaming/progress handling, session persistence, and
  model-catalog lookup code.
- BYOK has an API client, SSE text streaming, conversation-history files,
  model discovery through GET /models or /v1/models, and an Isle answer/action
  loop. The backend rejects ai.env if group/other permission bits are set.
- Assistant Settings can select providers and models, enter a model ID, and
  edit one Custom instructions text value.
- A separate optional FastMCP HTTP service exposes a selected set of Isle
  tools to external clients. It has loopback defaults, per-client scopes, and
  write allowlists.
- The current MCP tools cover tasks, Isle calendar events, reminders, calorie
  entries, prayer schedule/location, current media controls, focus state and
  controls, and opening HTTP(S) URLs through the desktop portal.

## Partial against the target

- **BYOK setup:** the endpoint and key are read from
  ~/.config/isle/ai.env or service environment variables. Assistant Settings
  does not provide base-URL or API-key fields; the user must configure the file
  manually. The provider entry is offered after an ai.env file exists, but the
  complete Settings
  configure → fetch → select → connect flow is not implemented or live-tested.
- **Internal MCP harness:** the in-Isle assistant does not call the external
  FastMCP server as its tool interface. OpenAI-compatible replies use Isle's
  JSON answer/action schema and existing action runner. This is Isle-owned
  execution, but it is not the MCP tool-call flow in the target.
- **Tool coverage:** the external MCP server exposes only the selected tools
  listed above. It does not cover every Isle page/action. For example, the
  Water D-Bus service exists but has no MCP tools; clipboard/shelf contents,
  notifications, calls, and other assistant actions are also outside the
  current MCP tool list.
- **OMP tools:** current OMP source starts RPC mode while keeping OMP's native
  tools, extensions, skills, and rules. That does not match a shared Isle MCP
  tool surface for Isle-owned operations. The earlier status text saying OMP
  disables its built-in tools was inaccurate.
- **Personality and memory:** Settings stores one
  voice-custom-instructions string. There are no Isle-managed SOUL.md,
  USER.md, or MEMORY.md files. Hermes/BYOK conversation-history files are
  transcripts, not those durable context files.
- **Model catalog:** OMP model-catalog code exists. Prior live notes report
  that OMP v18.12.6 can reject the full catalog because of its RPC response
  limit; this remains unverified against the user's current OMP install.

## Not yet accepted end to end

- Hermes multi-step tool use, continuation, cancellation, and error recovery
  have not been verified against the user's live Hermes gateway.
- OMP multi-step tool use and the intended Isle-MCP integration have not been
  verified against a live OMP installation.
- BYOK endpoint setup, model fetch, chat, tool calls, continuation, and
  cancellation have not been verified against a live compatible service.
- The MCP HTTP server, authentication scopes, write allowlists, and desktop
  portal operation have not been exercised with a live MCP client in this
  audit.
- Secret-file permissions and redaction should be checked as part of the
  Settings configuration implementation.

## Documentation corrections made in this audit

- The target now explicitly calls for a shared Isle MCP tool registry,
  Assistant Settings for BYOK configuration/model fetching, and Isle-managed
  SOUL.md, USER.md, and MEMORY.md for non-Hermes coding agents.
- OMP's current native-tool behavior is documented accurately.
- The current external MCP surface is distinguished from the future internal
  assistant harness.

See [assistant-platform-tasks.md](assistant-platform-tasks.md) for remaining
work and acceptance criteria.
