# Isle Assistant and MCP Work

This tracks the target in [assistant-platform-plan.md](assistant-platform-plan.md).
The in-app assistant (Hermes and OMP) and the external MCP server are separate
surfaces. Source implementation and live acceptance are reported in
[assistant-platform-status.md](assistant-platform-status.md).

## Existing source, not full acceptance

- Isle has in-app provider code for Hermes and OMP. Other provider adapters
  and OpenAI-compatible code exist in source but are outside this target.
- Isle's assistant has an answer/action loop for actions executed by Isle.
  It does not need to call the external MCP server.
- The optional external MCP service currently exposes a selected subset of
  Isle features. Its current tools do not cover all Isle data and actions.
- Assistant Settings has one Custom instructions field. It does not manage
  Isle-owned `SOUL.md`, `USER.md`, and `MEMORY.md` files for OMP.

## Ordered work

### 1. Inventory all Isle data and actions for MCP

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

### 2. Complete the external MCP server

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

### 3. Complete the in-app Hermes and OMP flows

- [ ] Verify Hermes API connection, model selection where supported,
  multi-step actions, continuation, cancellation, and failure recovery.
- [ ] Verify OMP RPC connection, model selection, multi-step actions,
  continuation, cancellation, and failure recovery.
- [ ] Ensure Isle-owned assistant actions go through Isle's action and
  approval path. Do not add MCP calls to the internal provider flow.
- [ ] Keep OMP's native coding-agent tools and runtime behavior available.
- [ ] Keep Hermes' personality and memory under Hermes' control.

Acceptance: Hermes and OMP each complete multi-step tasks in the Isle UI,
show progress, handle errors, and execute Isle-owned actions through Isle.

### 4. Add Isle-managed context files for OMP

- [ ] Define the Isle-owned locations and size limits for `SOUL.md`,
  `USER.md`, and `MEMORY.md`.
- [ ] Add Assistant Settings editors for the three files.
- [ ] Load the files into OMP sessions.
- [ ] Define safe memory updates before allowing OMP to write `MEMORY.md`.
- [ ] Keep Hermes' own personality and memory untouched.

Acceptance: edits affect the next OMP session, persist across restarts, and do
not change Hermes' own identity or memory.

### 5. Complete live acceptance and record results

- [ ] Exercise Hermes against the installed local API.
- [ ] Exercise OMP against the installed runtime.
- [ ] Connect an external MCP client using that client's own MCP settings.
- [ ] Check representative reads and writes across all Isle feature areas,
  including a date-filtered calorie query.
- [ ] Verify read scopes, write allowlists, authentication, invalid inputs,
  audit output, service restart, and continuation.

Acceptance: record exact runtime/client versions and results in
[assistant-platform-status.md](assistant-platform-status.md). Mark work done
only after its acceptance criteria pass.
