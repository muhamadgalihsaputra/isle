# SPDX-License-Identifier: GPL-3.0-or-later
"""MCP tools for Isle's local D-Bus services."""

import asyncio
import json
import logging
import os

from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import StaticTokenVerifier
from fastmcp.server.dependencies import get_access_token
from dbus_next import BusType, Message
from dbus_next.aio import MessageBus

BUS = "io.github.zickrian.isle.Daemon"
PATH = "/io/github/zickrian/isle/Daemon"
WRITE_TOOLS = {item.strip() for item in os.getenv("ISLE_MCP_WRITE_TOOLS", "").split(",") if item.strip()}
HOST = os.getenv("ISLE_MCP_HOST", "127.0.0.1")
PORT = int(os.getenv("ISLE_MCP_PORT", "8765"))
TOKEN = os.getenv("ISLE_MCP_TOKEN", "")
CLIENTS_PATH = os.getenv("ISLE_MCP_CLIENTS_FILE", os.path.expanduser("~/.config/isle/mcp-clients.json"))
try:
    if os.path.exists(CLIENTS_PATH) and os.stat(CLIENTS_PATH).st_mode & 0o077:
        raise SystemExit(f"{CLIENTS_PATH} must be private (chmod 600)")
    with open(CLIENTS_PATH, encoding="utf-8") as client_file:
        CLIENTS = json.load(client_file)
except FileNotFoundError:
    CLIENTS = json.loads(os.getenv("ISLE_MCP_CLIENTS", "{}"))
LOG = logging.getLogger("isle-mcp")

if TOKEN and not CLIENTS:
    CLIENTS = {"default": {"token": TOKEN, "scopes": ["*:read"]}}
TOKENS = {entry["token"]: {"sub": name, "client_id": name, "scopes": entry.get("scopes", [])}
          for name, entry in CLIENTS.items() if entry.get("token")}
if HOST not in {"127.0.0.1", "::1", "localhost"} and not TOKENS:
    raise SystemExit("Configure ISLE_MCP_TOKEN or a private ISLE_MCP_CLIENTS_FILE before binding beyond loopback")
auth = StaticTokenVerifier(tokens=TOKENS) if TOKENS else None
mcp = FastMCP("Isle", auth=auth)
bus: MessageBus | None = None


async def call(interface: str, member: str, signature: str = "", *args):
    if bus is None:
        raise RuntimeError("Isle MCP server is not connected to the session bus")
    response = await bus.call(Message(destination=BUS, path=PATH, interface=interface,
                                      member=member, signature=signature, body=list(args)))
    if response.message_type.name == "ERROR":
        raise RuntimeError(response.body[0] if response.body else response.error_name)
    return response.body[0] if response.body else None


READ_SCOPES = {
    "list_tasks": "tasks:read", "list_calendar_events": "calendar:read", "list_reminders": "reminders:read",
    "list_food_entries": "calories:read", "prayer_schedule": "prayer:read", "now_playing": "media:read",
    "focus_state": "focus:read",
}
WRITE_SCOPES = {
    "add_task": "tasks:write", "set_task_done": "tasks:write", "add_calendar_event": "calendar:write",
    "remove_calendar_event": "calendar:write", "add_reminder": "reminders:write", "add_food_entry": "calories:write",
    "update_food_entry": "calories:write", "remove_food_entry": "calories:write", "set_prayer_location": "prayer:write",
    "control_media": "media:write", "start_focus": "focus:write", "pause_focus": "focus:write", "stop_focus": "focus:write",
    "open_url": "desktop:write",
}


async def authorize(tool: str, *, write_access: bool = False):
    token = get_access_token() if auth else None
    if auth and token is None:
        raise PermissionError("authentication is required")
    if token is None:
        return
    scope = (WRITE_SCOPES if write_access else READ_SCOPES).get(tool)
    if scope is None:
        raise PermissionError(f"{tool} has no permission mapping")
    if scope not in token.scopes and not (scope.endswith(":read") and "*:read" in token.scopes):
        LOG.warning("MCP permission denied: client=%s tool=%s required=%s", token.client_id, tool, scope)
        raise PermissionError(f"{tool} requires {scope} permission")


async def read(tool: str, interface: str, prop: str):
    await authorize(tool)
    token = get_access_token() if auth else None
    LOG.info("MCP read tool called: client=%s tool=%s", token.client_id if token else "loopback", tool)
    variant = await call("org.freedesktop.DBus.Properties", "Get", "ss", interface, prop)
    return json.loads(variant.value)


async def write(tool: str):
    await authorize(tool, write_access=True)
    if tool not in WRITE_TOOLS:
        token = get_access_token() if auth else None
        LOG.warning("MCP write denied: client=%s tool=%s", token.client_id if token else "loopback", tool)
        raise PermissionError(f"{tool} is disabled; add it to ISLE_MCP_WRITE_TOOLS to allow it")
    token = get_access_token() if auth else None
    LOG.info("MCP write tool called: client=%s tool=%s", token.client_id if token else "loopback", tool)


@mcp.tool
async def list_tasks() -> list:
    """List Isle to-do items."""
    return await read("list_tasks", "io.github.zickrian.isle.Todo1", "Items")


@mcp.tool
async def add_task(title: str) -> int:
    """Add a to-do item in Isle. Requires add_task write permission."""
    await write("add_task")
    return await call("io.github.zickrian.isle.Todo1", "Add", "s", title)


@mcp.tool
async def set_task_done(task_id: int, done: bool = True) -> str:
    """Mark an Isle to-do item done or reopen it. Requires set_task_done permission."""
    await write("set_task_done")
    await call("io.github.zickrian.isle.Todo1", "SetDone", "tb", task_id, done)
    return "updated"


@mcp.tool
async def list_calendar_events() -> list:
    """List Isle's own calendar events."""
    return await read("list_calendar_events", "io.github.zickrian.isle.Calendar1", "Events")


@mcp.tool
async def add_calendar_event(date: str, text: str) -> int:
    """Add a calendar event on YYYY-MM-DD. Requires add_calendar_event permission."""
    await write("add_calendar_event")
    return await call("io.github.zickrian.isle.Calendar1", "Add", "ss", date, text)


@mcp.tool
async def remove_calendar_event(event_id: int) -> str:
    """Remove one Isle calendar event. Requires remove_calendar_event permission."""
    await write("remove_calendar_event")
    await call("io.github.zickrian.isle.Calendar1", "Remove", "t", event_id)
    return "removed"


@mcp.tool
async def list_reminders() -> list:
    """List scheduled Isle reminders."""
    return await read("list_reminders", "io.github.zickrian.isle.Reminders1", "Items")


@mcp.tool
async def add_reminder(text: str, delay_minutes: int) -> int:
    """Schedule an Isle reminder up to one week away. Requires add_reminder permission."""
    await write("add_reminder")
    if not 0 <= delay_minutes <= 10_080:
        raise ValueError("delay_minutes must be between 0 and 10080")
    return await call("io.github.zickrian.isle.Reminders1", "Add", "ts", delay_minutes * 60_000, text)


@mcp.tool
async def list_food_entries() -> list:
    """List locally stored Isle calorie entries."""
    return await read("list_food_entries", "io.github.zickrian.isle.Calories1", "Entries")


@mcp.tool
async def add_food_entry(food: str, calories: int) -> int:
    """Log food and its calorie count locally. Requires add_food_entry permission."""
    await write("add_food_entry")
    return await call("io.github.zickrian.isle.Calories1", "Add", "su", food, calories)


@mcp.tool
async def update_food_entry(entry_id: int, food: str, calories: int) -> str:
    """Edit a calorie entry. Requires update_food_entry permission."""
    await write("update_food_entry")
    await call("io.github.zickrian.isle.Calories1", "Update", "tsu", entry_id, food, calories)
    return "updated"


@mcp.tool
async def remove_food_entry(entry_id: int) -> str:
    """Remove a calorie entry. Requires remove_food_entry permission."""
    await write("remove_food_entry")
    await call("io.github.zickrian.isle.Calories1", "Remove", "t", entry_id)
    return "removed"


@mcp.tool
async def prayer_schedule() -> dict:
    """Get today's prayer times for the configured Isle location."""
    await call("io.github.zickrian.isle.Prayer1", "RefreshNow")
    return await read("prayer_schedule", "io.github.zickrian.isle.Prayer1", "Schedule")


@mcp.tool
async def set_prayer_location(city: str, country: str) -> str:
    """Set the city used for prayer times. Requires set_prayer_location permission."""
    await write("set_prayer_location")
    await call("io.github.zickrian.isle.Prayer1", "SetLocation", "ss", city, country)
    return "updated"


@mcp.tool
async def now_playing() -> dict:
    """Read the current Isle media player and track."""
    return await read("now_playing", "io.github.zickrian.isle.Media1", "NowPlaying")


@mcp.tool
async def control_media(command: str) -> str:
    """Control the active player: play_pause, next, or previous. Requires control_media permission."""
    await write("control_media")
    methods = {"play_pause": "PlayPause", "next": "Next", "previous": "Previous"}
    method = methods.get(command)
    if method is None:
        raise ValueError("command must be play_pause, next, or previous")
    await call("io.github.zickrian.isle.Media1", method)
    return "sent"


@mcp.tool
async def focus_state() -> dict:
    """Read Isle's focus timer and today's completed focus sessions."""
    return await read("focus_state", "io.github.zickrian.isle.Pomodoro1", "State")


@mcp.tool
async def open_url(url: str) -> str:
    """Open an HTTP or HTTPS URL in the desktop browser. Requires desktop:write and open_url allowlist permission."""
    await write("open_url")
    if not url.startswith(("https://", "http://")) or any(ord(char) < 32 for char in url):
        raise ValueError("url must be an HTTP or HTTPS URL")
    response = await bus.call(Message(destination="org.freedesktop.portal.Desktop",
        path="/org/freedesktop/portal/desktop", interface="org.freedesktop.portal.OpenURI",
        member="OpenURI", signature="ssa{sv}", body=["", url, {}]))
    if response.message_type.name == "ERROR":
        raise RuntimeError(response.body[0] if response.body else response.error_name)
    return "opened"


@mcp.tool
async def start_focus() -> str:
    """Start or resume Isle's focus timer. Requires start_focus permission."""
    await write("start_focus")
    await call("io.github.zickrian.isle.Pomodoro1", "Start")
    return "started"


@mcp.tool
async def pause_focus() -> str:
    """Pause Isle's focus timer. Requires pause_focus permission."""
    await write("pause_focus")
    await call("io.github.zickrian.isle.Pomodoro1", "Pause")
    return "paused"


@mcp.tool
async def stop_focus() -> str:
    """Stop Isle's focus timer. Requires stop_focus permission."""
    await write("stop_focus")
    await call("io.github.zickrian.isle.Pomodoro1", "Stop")
    return "stopped"


async def serve():
    global bus
    bus = await MessageBus(bus_type=BusType.SESSION).connect()
    await mcp.run_async(transport="http", host=HOST, port=PORT, path="/mcp")


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("ISLE_MCP_LOG", "INFO"))
    asyncio.run(serve())
