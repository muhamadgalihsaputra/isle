# Isle Assistant and MCP: Target Architecture

This document describes two separate products: the assistant that runs inside
Isle, and the MCP server that lets AI agents outside Isle use Isle's features.
Current implementation is in [assistant-platform-status.md](assistant-platform-status.md);
remaining work is in [assistant-platform-tasks.md](assistant-platform-tasks.md).

## 1. Assistant inside Isle

The in-app assistant is Isle's own harness. Its supported runtimes are Hermes
Agent and Oh My Pi (OMP). Isle owns provider selection, its UI, Isle-specific
context, the actions it executes, and the permissions for those actions.

- **Hermes Agent:** connect to Hermes through its local API. Keep Hermes'
  identity, personality, memory, and native runtime behavior. Isle handles
  Isle-owned desktop actions through its own action and approval path. Hermes'
  native tools execute inside its gateway and use Hermes' permissions; their
  approval requests are not currently bridged into Isle's alert UI.
- **Oh My Pi:** connect through OMP's RPC interface. Keep OMP's native coding
  tools and runtime behavior. OMP can use Isle's in-app action path for
  Isle-owned actions; those actions still go through Isle's permissions.
  OMP's configured default model is the normal choice; allow a manual
  `provider/model` override without loading the full model catalog in Settings.
  Native tools that need approval must keep their approval behavior; never
  silently enable auto-approval to make headless calls pass.

The target is a reliable multi-step assistant flow for both runtimes, including
model selection where available, visible progress, action results,
continuation, cancellation, and useful errors.

Direct OpenAI-compatible BYOK is not a target provider for the in-app
assistant. AI agents that use OpenAI-compatible models can use their existing
harness and connect to Isle through the external MCP server described below.
Existing provider code outside Hermes and OMP is not part of this target.

## 2. MCP for AI agents outside Isle

The MCP server is an external interface to Isle's features. It wraps Isle's
data and actions as MCP tools so agents such as Claude Code, Antigravity, or
Codex can call them. Configure the MCP endpoint and credentials in the external agent's own
MCP settings. This is not an internal tool protocol for the assistant inside
Isle, and the external agent's model or API key is not configured in Isle.

The MCP surface must cover all Isle pages and capabilities, including useful
ways to query their data. For example, an agent must be able to request food
entries for a specific date or date range and receive the matching records;
it must not only be able to add a food entry. Inventory every existing Isle
read and action, including tasks, reminders, calendar, focus, media, prayer,
calories, water, clipboard/shelf, notifications, calls, usage, and any other
Isle-owned capability. Define typed inputs and results for each operation.

Apply per-client scopes and write allowlists. Read-only data queries should be
available under read scopes; writes and sensitive desktop actions need the
appropriate authorization and audit trail. If a capability cannot be exposed,
record its specific technical or security reason and provide the closest
useful supported operation where possible.

The MCP server and the in-app assistant may call the same underlying Isle
services, but they remain separate interfaces with separate clients and setup.
Do not require the in-app Hermes or OMP adapter to speak MCP.

## Isle-managed context for OMP

Isle manages three context files for OMP, the non-Hermes runtime in the
in-app assistant:

- `SOUL.md`: personality and working style.
- `USER.md`: stable information and preferences about the user.
- `MEMORY.md`: durable facts and decisions to carry between conversations.

Make these editable in Assistant Settings and include them in OMP sessions.
Hermes continues to manage its own personality and memory. Conversation
transcripts are separate from these context files. Define file locations,
size limits, and safe memory updates before allowing automatic writes.

## Settings boundaries

Assistant Settings configure the in-app Hermes or OMP runtime, model where
available, and Isle-managed OMP context. MCP client setup belongs in the
external agent's own MCP settings; Isle's MCP server configuration covers its
endpoint, authentication, and permissions. Do not add an OpenAI-compatible
provider, base-URL field, or model API-key field to Assistant Settings for
this target.

## Security and reliability

- Keep Hermes and OMP secrets out of logs and diagnostics; preserve their
  runtime-specific secure configuration.
- Keep the Hermes API server bound to loopback and require its API key: the
  endpoint grants access to Hermes' full native toolset.
- Keep sensitive D-Bus caller checks in place.
- Default the MCP server to loopback. Require authentication for non-loopback
  binds and use per-client scopes and write allowlists.
- Apply read, data-write, and sensitive-action permissions consistently to
  MCP calls. Do not expose unrestricted D-Bus operations as tools.
- Verify invalid inputs, date filters, authorization failures, tool errors,
  cancellation, continuation, and service restarts.

## Acceptance

1. Hermes and OMP each complete a multi-step request in the Isle assistant UI
   and route Isle-owned actions through Isle's permission path.
2. An external MCP client can discover and use tools for every inventoried
   Isle capability, with useful read queries as well as actions. For example,
   a date-filtered calorie query returns the matching data.
3. An external agent connects using its own MCP settings and receives results
   from Isle; its model/provider credentials remain in that agent's harness.
4. MCP read scopes, write allowlists, authentication, and audit behavior are
   verified for local and authenticated network access.
5. OMP receives Isle-managed `SOUL.md`, `USER.md`, and `MEMORY.md`; Hermes'
   own identity and memory remain untouched.
