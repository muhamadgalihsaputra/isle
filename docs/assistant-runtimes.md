# Assistant runtimes

The Isle assistant can use Claude Code, Codex, Antigravity, Hermes Agent, or an OpenAI-compatible chat endpoint. Isle owns the desktop action loop: every runtime returns Isle's action format, and Isle runs or asks for approval for those actions.

## Hermes Agent

Use [Hermes' local API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server). In `~/.hermes/.env`, set `API_SERVER_ENABLED=true` and a strong `API_SERVER_KEY`, then run `hermes gateway`. Keep the API server bound to its default loopback address. Isle reads the key from that file and connects to `http://127.0.0.1:8642/v1`.

Hermes' API server normally runs its own tools, including terminal and file tools. To keep tool execution in Isle, disable tools specifically for the API server in `~/.hermes/config.yaml`:

```yaml
platform_toolsets:
  api_server: [memory]
```

This allows Hermes' own memory tools while blocking its terminal, file, and other action tools. Isle checks `/v1/toolsets` before each answer and refuses to proceed if Hermes reports any enabled non-memory toolset. The setting is per Hermes API server platform; verify it after upgrading Hermes.

Hermes uses its configured default model when Isle's model field is empty. Isle's extra coding-agent personality text is not applied to Hermes; Isle's system instructions are added to Hermes' own prompt.

## OpenAI-compatible API (BYOK)

Create `~/.config/isle/ai.env`, readable only by your user (`chmod 600`):

```ini
ISLE_OPENAI_BASE_URL=https://api.example.com/v1
ISLE_OPENAI_API_KEY=your-key
```

The endpoint must implement chat completions and return JSON content. Isle looks for models at `/models`, then `/v1/models`, and displays returned IDs in Assistant settings. You can also enter a model ID directly. The key is not stored in GNOME settings or included in diagnostic output.

## Oh My Pi

Install and configure `omp` with the provider/model you want. Select **Oh My Pi** in Assistant settings; the model is optional, and an empty field uses OMP's configured default. The picker also lists OMP's full model catalog (RPC `get_available_models`, shown as `provider/id`); listing waits for OMP's background model discovery, so a first open can come back empty and fill in on retry. On OMP installs with a large catalog the listing can fail outright — OMP v18.12.6 refuses it ("RPC response exceeded the transport limit") and its RPC protocol has no chunked alternative — in which case the picker keeps the default plus the free-text entry. Isle starts `omp --mode rpc` with OMP's built-in tools disabled, appends Isle's action instructions, and stores the conversation under Isle's private data directory. Desktop actions still pass through Isle, including its command approval card. Closing or cancelling a run stops the OMP process; the session can be resumed on the next request. The OMP RPC interface is documented in the [Oh My Pi RPC reference](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md).
