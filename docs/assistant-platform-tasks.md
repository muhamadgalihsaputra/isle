# Isle Assistant and MCP Work

This tracks the target in [assistant-platform-plan.md](assistant-platform-plan.md).
The in-app assistant and external MCP server are separate surfaces. OMP is the
first implementation priority, followed by Hermes and then MCP coverage.
Source implementation and live acceptance are tracked in
[assistant-platform-status.md](assistant-platform-status.md).

## Existing source, not full acceptance

- The OMP RPC adapter and Isle answer/action loop exist. A prompt to OMP's
  configured default and a one-prompt RPC round trip both returned
  successfully. The in-app response, Isle action, and native-tool flow still
  need verification.
- Assistant Settings used to synchronously request OMP's full model catalog.
  That call took about 27 seconds in the local CLI and exceeded Settings'
  eight-second timeout. Settings now offers OMP's configured default and an
  optional manual model ID instead.
- The optional external MCP service currently exposes a selected subset of
  Isle features. It does not cover all Isle data and actions.
- Assistant Settings has one Custom instructions field. It does not manage
  Isle-owned `SOUL.md`, `USER.md`, and `MEMORY.md` files for OMP.

## Ordered work

### 1. Make OMP usable inside Isle

- [x] Avoid fetching OMP's full model catalog synchronously from Settings.
- [x] Verify the configured default responds through OMP's RPC protocol.
- [x] Verify a native OMP bash tool runs through RPC under OMP's configured
  permissions.
- [x] Route OMP native-tool approval requests through Isle's existing agent
  Allow / Deny alert and return the choice to OMP without changing OMP's
  permission settings.
- [ ] Verify an OMP native-tool approval in a live Isle UI: Allow, Deny,
  dismissed alert, and alert unavailable.
- [ ] Verify the in-app OMP process starts, accepts a prompt, streams a reply,
  and returns Isle actions through the existing answer/action loop.
- [ ] Verify OMP's configured default model and manually entered `provider/id`
  both work.
- [ ] Verify session continuation, cancellation, failures, and warm startup.

Acceptance: OMP answers and performs an Isle action in the Isle UI, reports
tool or model failures clearly, and does not make Settings wait for model
catalog discovery.

### 2. Add Isle-managed context files for OMP

- [ ] Define the Isle-owned locations and size limits for `SOUL.md`,
  `USER.md`, and `MEMORY.md`.
- [ ] Add Assistant Settings editors for the three files.
- [ ] Load the files into OMP sessions.
- [ ] Define safe memory updates before allowing OMP to write `MEMORY.md`.

Acceptance: edits affect the next OMP session and persist across restarts.

### 3. Complete the Hermes flow inside Isle

- [ ] Verify Hermes API connection, model selection, multi-step Isle actions,
  continuation, cancellation, and failure recovery.
- [ ] Keep Hermes' personality and durable memory under Hermes' control.

Acceptance: Hermes completes multi-step requests in the Isle UI and routes
Isle-owned actions through Isle's permission path.

### 4. Inventory all Isle data and actions for external MCP

- [ ] List every Isle page, data source, and user action.
- [ ] Define MCP tools for each read and action, with typed inputs and
  structured results.
- [ ] Define useful query filters, including date and date-range queries for
  time-based data such as calories, calendar events, reminders, and usage.
- [ ] Include current gaps such as Water, clipboard/shelf, notifications,
  calls, and any other Isle capabilities found in the inventory.
- [ ] For writes and sensitive desktop actions, define scopes, allowlists,
  audit records, and whether the call is denied or requires approval.

Acceptance: an external agent can retrieve Isle data by useful selectors (for
example, calories for a requested date) and perform the inventoried actions.
Every Isle capability has a tool or a specific documented technical/security
reason why it cannot be exposed.

### 5. Complete the external MCP server

- [ ] Implement the inventory as the MCP server's tool surface.
- [ ] Route calls through Isle services and action checks; do not expose
  unrestricted D-Bus operations.
- [ ] Keep client scopes, write allowlists, loopback defaults, and
  authentication for network binds.
- [ ] Return matching records for date and date-range filters, with stable
  ordering and clear empty-result behavior.
- [ ] Add coverage for authorization, rejected writes, bad inputs, audit
  output, and successful read/write results.
- [ ] Document how external MCP clients configure Isle's endpoint and
  credentials in their own settings (Claude Code, Antigravity, Codex, etc.).

Acceptance: external MCP clients can discover and use every inventoried Isle
tool, with results and permissions verified. The MCP server is not used as an
internal tool protocol by the Isle assistant.

### 6. Complete live acceptance and record results

- [ ] Exercise OMP against the installed runtime, including an Isle action.
- [ ] Exercise Hermes against the installed local API.
- [ ] Connect an external MCP client using that client's own MCP settings.
- [ ] Check representative reads and writes across all Isle feature areas,
  including a date-filtered calorie query.
- [ ] Verify MCP scopes, write allowlists, authentication, invalid inputs,
  audit output, service restart, and continuation.

Acceptance: record exact runtime/client versions and results in
[assistant-platform-status.md](assistant-platform-status.md). Mark work done
only after its acceptance criteria pass.
