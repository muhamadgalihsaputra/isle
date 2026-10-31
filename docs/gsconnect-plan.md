# Isle × GSConnect: Device Integration Plan

This document describes how Isle integrates with GSConnect, the KDE Connect
implementation for GNOME Shell, so the phone in the user's pocket shows in the
island the way the laptop's own battery, network and calls already do. The
remaining work is tracked in [gsconnect-tasks.md](gsconnect-tasks.md).

GSConnect is not required. Every part of this integration degrades to nothing
when GSConnect is missing, disabled, or has no paired device; no page keeps a
tab, no status stays, no alert is lost. Isle discovers and follows GSConnect
over D-Bus, never by polling, and never by reading GSConnect's files.

## 1. Why

The island's job is "know when something changes, at a glance" (see
product-spec.md, section 1). The phone is the largest source of those changes:
messages, calls, and its own battery. Today a phone notification reaches the
island only as a generic GNOME notification, without the sender, the app, or a
way to answer it. GSConnect already holds that structure, so Isle reads it
there instead of building its own device stack.

## 2. D-Bus surface

GSConnect exports, on the session bus:

- `org.gnome.Shell.Extensions.GSConnect`: the service itself, with the
  `GetDevices` method and the list of paired devices.
- `org.gnome.Shell.Extensions.GSConnect.Device`: one per device, with the
  `battery` property (0–100, `-1` when the device does not report one) and the
  plugins that device supports.
- Device packets, arriving over the `packet` signal or the notification
  plugin's `notification` signal, carrying telephony events (calls, SMS,
  chat messages) and the means to reply to them (telephony `reply`,
  notification `reply`).

Isle's daemon (`isled`) watches these the same way it watches UPower,
NetworkManager and BlueZ (see `system/mod.rs`): a watcher that comes up when
the name appears on the bus, follows it if the service restarts, and goes away
cleanly when it does. The extension subscribes to the daemon, never to
GSConnect directly, so the whole integration lives behind one boundary and
turns off in one place.

## 3. What shows, and where

The presentation follows the island's own grammar; nothing invents a new
surface.

### Compact island (closed)

- **Phone battery chip**: a live status like the weather and the timer, one
  chip per reporting device, at most one by default (the first connected
  device; more only if several are paired and connected). Its icon is the
  device type (phone, tablet), its figure the percentage, tinted red under
  20%. It joins `_spreadStatuses` and takes its side like any other status.
- **No device chip for mere pairing.** A paired-but-disconnected phone shows
  nothing; a chip that said "not here" would be noise.

### Peek (alert)

- **Incoming message**: sender, app, and the message body, with a Reply
  button that answers with the quick replies the notification plugin already
  offers (and a free-text reply in the island's input, once one exists).
- **Incoming call**: caller, and Accept / Decline buttons, routed to the
  telephony plugin.
- **Battery alerts**: charging full, and low battery under 15%, once per
  drop, not on every report.

### Expanded island (page)

- **Devices page**: one row per connected device — name, type icon, battery
  with charge state, and the actions its plugins allow: Find My Phone (ring),
  Send File, Send Clipboard. The page has no tab when no device is connected;
  it is hidden by Settings like any other page.

### Assistant

- New actions in the answer schema (`answer.rs`): `find_phone` (ring), and
  `send_to_device` (file or clipboard). They run only with GSConnect present
  and the device connected, and the usual agent Allow / Deny path applies.

## 4. Boundaries

- **No polling.** Everything arrives by D-Bus signal; the daemon holds the
  only subscription.
- **No new settings surface in v1.** The Devices page follows the
  hidden-pages setting every page already follows; battery chips and alerts
  are on with the page, off without it.
- **Privacy.** Message bodies are shown only in the alert; they are not kept
  in any list, not stored by the daemon, and not given to the assistant
  unless the user asks it something about them. Call and message actions go
  through the same approval path as every other agent action.
- **One dependency.** GSConnect's own version churn (plugin names, packet
  fields) is absorbed in the daemon's watcher; the extension and pages see a
  stable shape, so a GSConnect update can at worst disable a feature, never
  break the island.

## 5. Out of scope for v1

- Free-text SMS composition from scratch (replying to a received message only)
- Runescape-style remote input, mouse/keyboard control, presentation control
- File browsing on the phone
- Multiple simultaneous active devices beyond showing each one's battery
