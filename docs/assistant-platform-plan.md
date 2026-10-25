# Assistant Engines and Isle Tools

## Summary

Add selectable assistant runtimes to Isle, then expose Isle capabilities to other agents through an authenticated MCP HTTP server. Hermes is the first runtime, Oh My Pi follows through its RPC interface, and a direct OpenAI-compatible endpoint uses Isle's existing agent loop. Add prayer-time reminders and a local calorie log as new daily-life tools.

Hermes keeps its native personality and memory. Isle only supplies instructions for using Isle. Custom personality settings apply to coding-agent backends other than Hermes.

## Decisions

- Engine order: Hermes, Oh My Pi, then direct BYOK.
- Hermes uses its local API server. Oh My Pi uses its documented RPC protocol.
- Direct BYOK configures endpoint, API key, model discovery, and model selection; Isle retains tool execution, approvals, and the agent loop.
- OpenAI-compatible model discovery tries `/models` and `/v1/models`.
- MCP uses Python FastMCP over HTTP. Bind address is configurable; loopback is the default. Network binds require authentication.
- MCP callers use Isle's permission categories: read-only operations run directly, risky desktop actions require Isle approval, and data-entry permissions are configurable.
- Prayer times use AlAdhan with calculation method 20 (Kemenag Indonesia) and a user-selected location.
- Calorie entries are manual and stored locally.

## Implementation Tasks

See [assistant-platform-tasks.md](assistant-platform-tasks.md) for ordered work, dependencies, and acceptance criteria.

## Interfaces and data

- Extend assistant settings and daemon context with the selected engine and its connection/model configuration.
- Add an authenticated MCP HTTP surface backed by a narrow, explicitly authorized Isle tool interface. Do not remove existing GNOME Shell caller checks from sensitive D-Bus APIs.
- Add stored prayer location/reminder preferences and local calorie entries with UI and MCP operations.
- Add per-engine personality settings for supported non-Hermes coding-agent backends; pass Isle-specific instructions to Hermes without rewriting Hermes identity or memory files.

## Verification

- Exercise each backend's connection, streaming, follow-up, cancellation, model errors, and tool handoff.
- Connect an MCP client over loopback and a configured network bind; verify authentication and permission behavior.
- Check both model-list URL forms, malformed responses, and unreachable endpoints.
- Check prayer schedules across locations, time zones, day rollover, and missed notifications.
- Check calorie records across create, list, update, delete, and daemon restart.

## Risks

- Hermes API capabilities and local configuration must be verified against the installed Hermes version; keep the adapter behind a narrow interface.
- Oh My Pi RPC is a custom protocol and may evolve independently.
- A Python MCP server must be installed and launched reliably by Isle packaging, and must communicate with the daemon without bypassing caller authorization.
- Prayer-time results depend on location, time zone, and calculation conventions; display the chosen method and location.
- API credentials must not be written to ordinary settings or logs.
