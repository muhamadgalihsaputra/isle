# Assistant Platform Work

This list tracks the target in [assistant-platform-plan.md](assistant-platform-plan.md).
Source implementation and live acceptance are reported separately in
[assistant-platform-status.md](assistant-platform-status.md). A backend adapter
existing in source is not equivalent to an accepted user flow.

## Existing source, not full acceptance

- Hermes, OMP, and OpenAI-compatible BYOK have provider/backend code.
- BYOK has model-discovery code, but its base URL and key are configured in a
  file by hand rather than in Assistant Settings.
- The assistant has an Isle-owned JSON action loop. The external MCP service
  is a separate, optional service with a selected tool set; the assistant does
  not use it as its internal tool interface.
- The external MCP service has authentication and permission code, but its
  complete tool coverage and live behavior have not been accepted.
- Assistant Settings has one Custom instructions field. It does not manage the
  Isle-owned SOUL.md, USER.md, and MEMORY.md files required by the target.

## Ordered work

### 1. Inventory Isle capabilities and define tool permissions

- [ ] List every Isle page and assistant action that an agent should be able
  to use.
- [ ] For each capability, define its typed read/write operations, result
  shape, permission category, audit record, and whether user approval is
  required.
- [ ] Include current gaps such as Water and the other Isle features omitted
  from the external MCP service.

Acceptance: the inventory maps every Isle feature to an explicit tool and
permission rule. Any feature excluded from MCP has a documented security or
technical reason; no feature is described as covered without a tool and a
defined execution path.

### 2. Build one Isle-owned MCP tool registry and executor

- [ ] Define the common tool schemas and typed dispatch layer for the Isle
  assistant and external MCP clients.
- [ ] Route calls through existing Isle services and action/approval checks;
  do not expose unrestricted D-Bus operations as tools.
- [ ] Expand the external FastMCP service to expose the same registry and
  permission behavior.
- [ ] Keep per-client scopes, write allowlists, loopback defaults, and
  authentication for network binds.
- [ ] Add tests for authorization, rejected writes, bad inputs, audit output,
  and successful tool results.

Acceptance: supported MCP clients can discover every Isle tool in the
inventory; internal and external calls use the same authorization and
executor.

### 3. Connect assistant runtimes to Isle tools

- [ ] Add real tool-call handoff to the OpenAI-compatible chat loop: send tool
  definitions, execute calls through the Isle registry, return tool results,
  and continue the model turn.
- [ ] Connect OMP Isle-capability calls to the same registry and executor.
  OMP-native tools must not bypass Isle's controls for Isle-owned operations.
- [ ] Preserve Hermes' own identity, personality, and memory while routing
  Isle-owned actions through Isle's permission path.
- [ ] Verify that each tool result can drive another step and that cancellation
  stops both the provider request and pending Isle operation where possible.

Acceptance: Hermes, OMP, and BYOK each complete multi-step Isle tasks with
visible progress, correct results, approvals, cancellation, and recovery.

### 4. Finish the OpenAI-compatible Settings flow

- [ ] Add base URL and masked API-key controls to Assistant Settings.
- [ ] Save credentials outside GSettings with mode 0600 and keep them out of
  logs and diagnostic reports.
- [ ] Add explicit model fetch/refresh, model selection, connection state, and
  actionable errors.
- [ ] Keep direct model-ID entry for endpoints that do not expose a model
  catalog.
- [ ] Verify both /models and /v1/models response shapes and failures.

Acceptance: a user can configure, validate, fetch models, select a model, and
start a BYOK conversation entirely from Settings, without editing a file.

### 5. Add Isle-managed context files for non-Hermes agents

- [ ] Define and document the Isle-owned locations and size limits for
  SOUL.md, USER.md, and MEMORY.md.
- [ ] Add Assistant Settings editors for the three files.
- [ ] Load these files into every supported non-Hermes coding-agent context.
- [ ] Keep Hermes' own personality and memory untouched.
- [ ] Define safe memory updates before allowing an agent to write MEMORY.md.

Acceptance: edits affect the next non-Hermes session, persist across restarts,
and do not change Hermes' own identity or memory.

### 6. Complete live runtime and MCP acceptance

- [ ] Exercise Hermes against a running local gateway.
- [ ] Exercise OMP against an installed runtime, including tool routing and
  catalog behavior.
- [ ] Exercise BYOK against at least one compatible endpoint, including model
  discovery, tool handoff, cancellation, and error cases.
- [ ] Connect an external MCP client and check loopback and authenticated
  network-bind behavior.
- [ ] Verify secret permissions, redaction, approval handling, daemon restart,
  and conversation continuation.

Acceptance: record the exact provider versions and results in
[assistant-platform-status.md](assistant-platform-status.md); mark a task
complete only when its acceptance criteria pass.
