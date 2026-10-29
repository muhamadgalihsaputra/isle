# Isle MCP server for external AI agents

Isle exposes local Isle data and actions as MCP tools for AI agents running
outside Isle. The agent's MCP settings (for example, in Claude Code,
Antigravity, or Codex) point to this service; this is not a provider or internal tool interface for
the assistant inside Isle. This page documents the external service that is
currently implemented.

## Current implementation boundary

This is the optional **external** MCP service. It is not the tool interface
used by the assistant running inside Isle. The in-Isle assistant uses its
existing answer/action loop with Hermes or OMP; it does not need to call this
MCP server. Configure the MCP connection in the external agent's own settings,
not in Isle's Assistant Settings.

The current service exposes tasks, Isle calendar events, reminders, calorie
entries, prayer schedule/location, current media controls, focus timer state
and controls, and HTTP(S) URL opening. It does not yet cover every Isle page
or action. For example, the Water D-Bus service has no MCP tool, and clipboard
or shelf contents, notifications, calls, and other desktop actions are not in
this service's tool list.

The target is an external MCP tool surface that covers all Isle data and
actions. It must support useful reads as well as writes: for example, an
external agent should be able to request calories for a specific date or date
range and receive those records, such as `get_calories(date="2026-02-27")`.
This is a target example, not a tool available in the current service.
Inventory every Isle page and capability. Any exclusion needs a specific
technical or security reason. Calls should use Isle services and enforce
client scopes, write allowlists, and auditing. The target and its incomplete work are tracked in
[assistant-platform-plan.md](assistant-platform-plan.md)
and [assistant-platform-tasks.md](assistant-platform-tasks.md).

Install the optional Python runtime first:

```sh
isle-setup-mcp
```

The service listens on loopback port `8765` by default. To enable write tools,
create `~/.config/isle/mcp.env` with mode `0600` and list only the tools you
intend to allow:

```ini
ISLE_MCP_HOST=127.0.0.1
ISLE_MCP_PORT=8765
ISLE_MCP_WRITE_TOOLS=add_task,add_reminder,add_food_entry
```

Enable the user service:

```sh
systemctl --user enable --now isle-mcp.service
```

The endpoint is `http://127.0.0.1:8765/mcp`. Add this endpoint, and the bearer
token if configured, to the MCP settings of the external agent that should use
Isle. Each agent has its own way to store MCP server connections. For a
network bind, set a bearer
token in the private environment file too:

```ini
ISLE_MCP_HOST=0.0.0.0
ISLE_MCP_TOKEN=replace-with-a-long-random-token
```

The bearer token protects calls, but HTTP does not encrypt them. Keep remote
access on a trusted network or put the service behind a TLS reverse proxy; do
not expose it directly to an untrusted network. Configure each MCP client with
the bearer token when the service is bound beyond loopback.

For separate permissions per client, create `~/.config/isle/mcp-clients.json`
with mode `0600` and remove `ISLE_MCP_TOKEN` from `mcp.env`:

```json
{
  "calendar-reader": {"token": "a-long-random-token", "scopes": ["calendar:read", "prayer:read"]},
  "life-helper": {"token": "a-different-long-random-token", "scopes": ["*:read", "tasks:write", "reminders:write"]}
}
```

Read scopes are `tasks:read`, `calendar:read`, `reminders:read`,
`calories:read`, `prayer:read`, `media:read`, and `focus:read`. The `*:read`
scope grants all read-only tools. Write scopes use the same category followed
by `:write`; they still require the global `ISLE_MCP_WRITE_TOOLS` allowlist.
Each token is bound to its own scopes and client name. A caller's MCP
`client_id` is not used as an authorization identity.

Read tools expose Isle tasks, calendar events, reminders, calorie entries,
prayer times, focus timer state, and current media. Write tools are disabled
unless named in `ISLE_MCP_WRITE_TOOLS`. Available write names are `add_task`, `set_task_done`,
`add_calendar_event`, `remove_calendar_event`, `add_reminder`, `add_food_entry`,
`update_food_entry`, `remove_food_entry`, `set_prayer_location`, `start_focus`,
`pause_focus`, `stop_focus`, `control_media`, and `open_url`. `control_media`
permits play/pause, next, and previous. `open_url` opens an HTTP(S) URL through
the desktop portal and needs the `desktop:write` scope and the matching write
allowlist entry.

Prayer city and country are set in Isle Settings → Island → Daily Life; the local
calorie log is stored at `~/.local/share/isle/calories.json`. Food logging is
manual and does not estimate calories from meal names.

This current MCP surface uses Isle's public D-Bus interfaces. It does not
expose clipboard/shelf contents yet; those remain part of the target coverage
inventory. The shell-only assistant control API is an internal control
interface, not an Isle user feature exposed by this MCP service.
