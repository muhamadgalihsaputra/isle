# Isle Assistant Platform: Target Architecture

This is the target for the fork's assistant platform. Current implementation
status is tracked separately in [assistant-platform-status.md](assistant-platform-status.md);
ordered engineering work is in [assistant-platform-tasks.md](assistant-platform-tasks.md).

## Purpose

Isle is the assistant harness. It owns provider selection, Isle-specific
context, tool discovery and execution, permissions, approvals, and the UI that
shows progress. Hermes is the primary runtime. Oh My Pi is an additional
coding-agent runtime, and a direct OpenAI-compatible endpoint is an optional
BYOK runtime.

The target is not met by showing provider names or settings controls alone.
Each selectable runtime must complete a real multi-step request through Isle,
with working model selection, Isle tools, results, continuation, cancellation,
and errors.

## Runtime responsibilities

- **Hermes Agent:** connect to Hermes' local API. Preserve Hermes' own
  identity, personality, memory, and native runtime behavior. Isle adds its
  desktop context and keeps Isle-controlled actions behind Isle's permission
  and approval path.
- **Oh My Pi:** connect through OMP's RPC interface. Isle-specific capabilities
  must be available through Isle's tool registry and permission path; OMP
  native tools must not bypass Isle's controls for Isle-owned operations.
- **OpenAI-compatible BYOK:** let the user enter a base URL and API key in
  Assistant Settings, fetch the endpoint's model list, and choose a model.
  Keep the key out of GSettings and logs; store it in a user-private config
  file. Route tool calls through Isle's tool registry and executor.
- **Other coding-agent providers:** keep their existing provider-specific
  connection and approval behavior while giving them the same Isle-managed
  context and tool surface where supported.

## Isle tool surface

Every Isle feature that can be exposed safely must be represented in one
explicit Isle-owned MCP tool registry. The same registry and executor should
serve both the assistant inside Isle and external MCP clients; do not maintain
a smaller, unrelated tool list for each path. Any feature excluded for a
specific security or technical reason must have that reason documented.

Inventory every page and action before calling the tool surface complete. This
includes every Isle page and action: task, reminder, calendar, focus, media,
prayer, calorie, water, clipboard/shelf, notifications, calls, usage, and other
Isle-owned capabilities found in the inventory. Each tool needs a typed input
and result, a permission category, auditable execution, and a clear rule for
whether it runs directly or asks the user for approval. Provider-native tools
must not bypass approvals for Isle actions.

## Isle-managed context

For coding-agent runtimes other than Hermes, Isle manages three context files:

- SOUL.md: the agent's personality and working style.
- USER.md: stable information and preferences about the user.
- MEMORY.md: durable facts and decisions to carry between conversations.

Keep these as Isle-owned files, editable from Assistant Settings, and include
them in the supported non-Hermes coding-agent context. Hermes continues to
manage its own personality and memory. Conversation transcripts are separate
from these durable context files. File location, size limits, and how agents
may propose memory edits must be settled in the implementation task before
those files are written automatically.

## Assistant Settings

Assistant Settings must let the user:

- select Hermes, OMP, or an OpenAI-compatible endpoint;
- enter and save the BYOK base URL and API key securely;
- fetch, inspect, and select models, with useful connection and fetch errors;
- edit Isle-managed SOUL.md, USER.md, and MEMORY.md for non-Hermes agents;
- configure the shared Isle tool permissions and review the applicable
  approval behavior.

The current free-text Custom instructions field is not a replacement for the
three context files.

## Security and reliability

- Store API keys outside ordinary GSettings values, with user-only file
  permissions, and never include secrets in logs or diagnostics.
- Keep sensitive D-Bus caller checks in place.
- Default MCP network exposure to loopback. Require authentication for
  non-loopback binds.
- Apply the same read, data-write, and risky-desktop-action permissions to
  internal assistant calls and external MCP clients.
- Verify connection failure, malformed model lists, tool errors, cancellation,
  continuation, and provider restarts.

## Acceptance

The platform is complete when:

1. Hermes, OMP, and a configured OpenAI-compatible endpoint each complete a
   multi-step request in the Isle assistant UI.
2. The BYOK user can configure the endpoint and key in Settings, fetch models,
   select one, and use it without editing files manually.
3. Isle capabilities are discoverable and callable as MCP tools by supported
   runtimes and external MCP clients, with consistent permissions and results.
4. Non-Hermes coding agents receive the three Isle-managed context files;
   Hermes' own identity and memory remain untouched.
5. Local and live-provider checks cover approvals, model discovery, tool
   results, cancellation, continuation, and secret handling.
