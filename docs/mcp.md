# Isle MCP server

Isle can expose selected local tools to MCP clients over Streamable HTTP.
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

The endpoint is `http://127.0.0.1:8765/mcp`. For a network bind, set a bearer
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
prayer times, focus timer state, and current media. Write tools are disabled unless named in
`ISLE_MCP_WRITE_TOOLS`. Available write names are `add_task`, `set_task_done`,
`add_calendar_event`, `remove_calendar_event`, `add_reminder`, `add_food_entry`,
`update_food_entry`, `remove_food_entry`, `set_prayer_location`, `start_focus`,
`pause_focus`, `stop_focus`, `control_media`, and `open_url`. `control_media`
permits play/pause, next, and previous. `open_url` opens an HTTP(S) URL through the desktop portal and needs
the `desktop:write` scope and the matching write allowlist entry.

Prayer city and country are set in Isle Settings → Daily Life; the local
calorie log is stored at `~/.local/share/isle/calories.json`. Food logging is
manual and does not estimate calories from meal names.

This first MCP surface uses Isle's public D-Bus interfaces. It does not expose
clipboard contents or the shell-only assistant control API.
