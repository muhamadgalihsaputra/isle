# Assistant Runtimes: Current Setup and Gaps

The source includes Hermes Agent, Oh My Pi, OpenAI-compatible BYOK, and the
existing coding-agent CLIs. Isle currently receives an Isle answer/action
format and runs its own action loop. This is not yet the shared MCP
tool-calling architecture in [assistant-platform-plan.md](assistant-platform-plan.md).
See [assistant-platform-status.md](assistant-platform-status.md) for audited
implementation status.

## Hermes Agent

The current adapter uses Hermes' local API server. In ~/.hermes/.env, set
API_SERVER_ENABLED=true and a strong API_SERVER_KEY, then run hermes gateway.
Keep the API server bound to its default loopback address. Isle reads the key
from that file and connects to http://127.0.0.1:8642/v1.

Hermes keeps its own personality, memory, and native runtime behavior. Isle
adds its desktop instructions and executes Isle actions through Isle's action
loop. Live multi-step tool use and cancellation still need validation against
the installed Hermes version.

## OpenAI-compatible API (BYOK)

The current backend reads these values from ~/.config/isle/ai.env or the
service environment:

    ISLE_OPENAI_BASE_URL=https://api.example.com/v1
    ISLE_OPENAI_API_KEY=your-key

If using the file, create it with user-only permissions:

    chmod 600 ~/.config/isle/ai.env

The backend has model discovery for /models and /v1/models and a streaming chat
client. Assistant Settings currently has a model ID field and model picker,
but no base-URL or API-key controls; configuring the endpoint still requires
editing ai.env manually. The chat client currently asks the model for Isle's
JSON answer/action format. It does not yet send MCP tool definitions and
execute MCP tool calls.

Do not put the API key in GSettings or diagnostic output. The end-to-end
configure, fetch, select, and chat flow has not been verified against a live
compatible endpoint.

## Oh My Pi

Install and configure omp with the provider/model you want. Select Oh My Pi in
Assistant Settings; the model is optional, and an empty field uses OMP's
configured default. Isle starts omp in RPC mode, appends Isle instructions,
and stores the conversation under Isle's private data directory.

Current source keeps OMP's native tools, extensions, skills, and rules. This
does not yet route Isle-owned capabilities through a shared Isle MCP registry.
The OMP catalog lookup is implemented, but previous live notes report that
OMP v18.12.6 can reject the full catalog because of its RPC response limit.
Verify this against the installed OMP version before relying on model
discovery.

## Target

The intended design is documented in
[assistant-platform-plan.md](assistant-platform-plan.md): an Isle-owned MCP
tool surface for Isle capabilities; BYOK endpoint and key configuration in
Assistant Settings; model fetching; and Isle-managed SOUL.md, USER.md, and
MEMORY.md for supported non-Hermes coding agents. Hermes retains its own
personality and memory.
