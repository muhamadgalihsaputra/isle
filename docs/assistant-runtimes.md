# Isle Assistant Runtimes and External MCP

Isle's in-app assistant target is Hermes Agent and Oh My Pi (OMP). A separate
MCP server exposes Isle data and actions to AI agents running outside Isle.
The external agent connects using its own MCP settings; it is not another
provider in Isle's Assistant Settings. See the [platform plan](assistant-platform-plan.md)
and [implementation audit](assistant-platform-status.md).

## Hermes Agent inside Isle

The current adapter uses Hermes' local API server. In `~/.hermes/.env`, set
`API_SERVER_ENABLED=true` and a strong `API_SERVER_KEY`, then run
`hermes gateway`. Keep the API server bound to its default loopback address.
Isle reads the key from that file and connects to `http://127.0.0.1:8642/v1`.

Hermes keeps its own personality, memory, and native runtime behavior. Isle
adds its desktop instructions and executes Isle actions through Isle's action
loop. Live multi-step tool use and cancellation still need validation against
the installed Hermes version.

## Oh My Pi inside Isle

Install and configure `omp` with the provider and model you want. Select Oh My
Pi in Assistant Settings; the model is optional, and an empty field uses
OMP's configured default. Isle starts OMP in RPC mode, appends Isle
instructions, and stores the conversation under Isle's private data
directory.

Current source keeps OMP's native tools, extensions, skills, and rules. Isle
actions requested in the in-app assistant use Isle's action path. Isle-managed
`SOUL.md`, `USER.md`, and `MEMORY.md` for OMP are part of the target but are
not implemented yet. OMP v18.12.5 is installed on the audited machine. A
direct prompt to its configured default returned text, and a one-prompt RPC
round trip emitted `ready`, opened a session, streamed text deltas, and ended
with `prompt_result` `completed`. This verifies the configured provider and
RPC framing, but not a request through `isled` and the GNOME UI. The full
`omp models` catalog took about 27 seconds to list, so Assistant Settings now
uses OMP's configured default or an optional manual `provider/model` ID instead
of fetching the entire catalog automatically.

Isle starts OMP with `--mode rpc --no-ui`. OMP's RPC documentation says tools
that require interactive approval fail closed in this mode. The current
adapter does not yet surface OMP approval requests in Isle's UI; verify this
behavior before relying on OMP tools that need approval.

## External AI agents through MCP

Use Isle's optional MCP server when an agent outside Isle needs Isle data or
actions. Configure the MCP endpoint and any required bearer token in that
agent's own MCP settings (for example, in Claude Code, Antigravity, or Codex).
Isle does not configure the external agent's model, provider, or API key.

The current server exposes only a selected set of tools. The target is to
expose all Isle data and actions, including useful filtered reads such as
calories for a requested date. See [MCP server setup and current coverage](mcp.md).

## Scope note

OpenAI-compatible BYOK and other coding-agent adapters exist in source, but
they are not target runtimes for the assistant built into Isle. Use the
existing external agent harness for those providers and connect it to Isle
through MCP when it needs Isle capabilities.
