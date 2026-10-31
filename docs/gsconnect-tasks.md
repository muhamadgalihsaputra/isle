# Isle × GSConnect Work

This tracks the target in [gsconnect-plan.md](gsconnect-plan.md). Each phase
ends in something a user can see; nothing in a later phase starts before the
phase before it is verified on a live desktop with a paired phone.

## Ordered work

### 1. Daemon: watch GSConnect on the session bus

- [x] Add a `gsconnect` module to `isled` that follows the
  `org.gnome.Shell.Extensions.GSConnect` name on the session bus, under the
  same supervision pattern as UPower and NetworkManager (`system/mod.rs`):
  comes up when the name appears, backs off on failure, goes away cleanly.
- [ ] Read the device list and each device's `battery` and plugin support;
  re-read on the service's `deviceAdded` / `deviceRemoved` / `deviceChanged`
  signals, never on a timer.
- [ ] Publish the connected devices (name, type, battery, charging state,
  plugins) under the existing daemon `state` the extension already watches,
  with a `changed` signal on every D-Bus event.
- [ ] Verify: GSConnect off (nothing published, no errors), GSConnect on with
  no device, one device pairing, device connecting and disconnecting, service
  restart mid-session.

Acceptance: the daemon's state tracks a real phone's battery figure live,
without polling, and Isle stays silent with GSConnect gone.

### 2. Compact island: the phone battery chip

- [x] Add the chip to `compact.js` as one of `_statusItems`: device-type icon,
  percentage, red under 20%; joins `_spreadStatuses` like the weather.
- [x] Show it only while its device is connected and reporting (battery
  greater than -1); no chip for a paired-but-disconnected phone.
- [x] Count it in `preferredWidth` and `_spreadStatuses` like every other
  status (it is one of the spread statuses, so both count it already).
- [ ] Verify: chip takes a side and re-spreads with weather and timer on;
  notch keeps its centred assistant and level sides (the two pad widths);
  chip leaves without a trace when the phone disconnects.

Acceptance: the phone's battery reads at a glance in the closed notch, beside
the clock, and the notch stays balanced with it on and off.

### 3. Alerts: message, call, battery

- [ ] Daemon: subscribe to the notification and telephony packets for
  connected devices; keep the last message only, and only until its alert is
  dismissed.
- [ ] Extension: message peek with sender, app and body, and the device's
  offered quick replies as buttons; a reply routes back through the
  notification plugin's reply call.
- [ ] Extension: call peek with Accept / Decline, and the caller's name.
- [ ] Battery peeks: full charge and low under 15%, once per event.
- [ ] Verify against the peek spec widths (220–380, buttons whole to 440/560):
  a long message body truncates, two quick replies fit, and the call alert
  out-ranks a message alert.

Acceptance: a message arrives and is answered, and a call is declined, without
touching the phone.

### 4. Devices page

- [ ] New `pages/devices.js` following `Page` (`pages/page.js`): one row per
  connected device — name, type icon, battery and charge state, and the
  actions its plugins allow: ring (Find My Phone), send file (through the
  shelf's file picker pattern), send clipboard.
- [ ] Register in `controller.js` with a tab (name `devices`, icon
  `isle-phone`), hidden with `hidden-pages` like every page, and no tab at
  all when the daemon reports no connected device.
- [ ] Keep it light: built a step at a time like the other pages
  (`_buildPages`), nothing synchronous on load.
- [ ] Verify: page opens cold and warm, ring works, a send reaches the phone,
  and the tab appears and disappears as the device connects.

Acceptance: the phone is found and a file reaches it from the island, with no
page or tab while no device is there.

### 5. Assistant actions

- [ ] Add `find_phone` and `send_to_device` to the answer schema
  (`answer.rs`), and document them in the daemon's system prompt.
- [ ] Run them through the daemon's GSConnect module, only with a connected
  device; a missing GSConnect answers plainly ("no phone connected"), never
  an error dump.
- [ ] Verify: `find_phone` rings; `send_to_device` sends the clipboard; the
  Allow / Deny path covers `send_to_device` like other outbound actions.

Acceptance: "cari hp aku" rings the phone through the island's assistant.

## Not in this list

Remote input, file browsing, and free-text composition are out of scope for
v1; see the plan's section 5.
