# Isle × LLM Routers Work

This tracks the target in [router-plan.md](router-plan.md). Each phase
ends in something a user can see; nothing in a later phase starts
before the phase before it is verified on a live desktop with a real
gateway.

## Ordered work

### 1. Daemon: the gateway abstraction and the local token

- [ ] A `router` module in `isled` behind the `RouterGateway` trait
  (connect / stats / auth_mode), wired like the other watchers:
  publishes its state under the daemon `state` the extension already
  watches, with a `changed` signal on every refresh, never a timer
  while the island is closed.
- [ ] The 9Router implementation, Mode 1: read
  `~/.9router/data/machine-id` (fallback `~/.9router/machine-id`) and
  `~/.9router/data/auth/cli-secret`; derive
  `sha256(machineId + "9r-cli-auth" + cliSecret)` hex, first 16 chars;
  send it as `x-9r-cli-token` on every usage request.
- [ ] `GET /api/version` without auth on connect; below 0.4.42, publish
  the update warning and fetch no usage (the old endpoint's key leak).
- [ ] `GET /api/usage/stats?period=…` polled every 10–15 s while the
  island shows the chip or the page; 10 s timeout, one request in
  flight per endpoint, backoff 2 s → 5 s → 15 s → 60 s on failure,
  automatic recovery.
- [ ] Settings keys: `router-connection` (local | remote), base URL,
  period, notch toggle — all in the daemon's schema and the extension's.
- [ ] Verify on a live desktop: 9Router's npm default on the same
  machine, Local chosen, zero input — data appears without restarting
  Isle.

Acceptance: with a default 9Router running, the state carries live
usage numbers, and with it stopped, nothing is published and no error
reaches the console.

### 2. Compact island: the Router chip

- [ ] The chip in `compact.js` as one of `_statusItems`: requests ·
  cost "est." · top model, joined to `_spreadStatuses` like the weather
  (the bell's left-preference and the two-pass levelling apply to it
  as to every chip).
- [ ] The status dot: green connected (with the gateway version in its
  accessible name), grey offline, red unauthorized; a small pulse while
  `activeRequests` is not empty.
- [ ] Counted in `preferredWidth` like every other status.
- [ ] Verify: the chip takes a side and re-spreads with the timer and
  weather on; the notch keeps its centred assistant; the chip leaves
  without a trace when the gateway goes.

Acceptance: today's requests, the estimate, and the busiest model read
at a glance in the closed notch, beside the clock.

### 3. Settings: the panel

- [ ] The LLM Router panel: Connection (Local default / Remote), the
  Base URL and auth radios under Remote, period (today / 24h / 7d),
  the notch toggle, and the status line (connected + version /
  unauthorized / unreachable).
- [ ] Mode 1's fallback: on 401, offer the Remote flow at
  `http://localhost:20128` with a password, from the same panel.
- [ ] The version warning (below 0.4.42) shows in the panel, permanent
  until the gateway updates.
- [ ] Verify: switching Local ↔ Remote needs no restart; the status
  line follows the gateway within one poll.

Acceptance: a fresh user picks Local with zero input; a remote user
points at their base URL and is told what is wrong when it is.

### 4. Page: the Router page

- [ ] `pages/router.js` following `Page` (`pages/page.js`): the
  summary card (requests, tokens in/out/cached, cost "est."), top 5
  models by tokens as horizontal bars with compact numbers, the last
  10 requests (model, in→out, ok/error, relative time), scrollable,
  the period toggle in its header in step with Settings.
- [ ] Registered in `controller.js` with a tab (name `router`), hidden
  with `hidden-pages` like every page; no tab while the gateway is
  unreachable or unauthorized.
- [ ] Built a step at a time like the other pages (`_buildPages`),
  nothing synchronous on load; renders at most once a second.
- [ ] Verify: the page opens cold and warm; the period toggle changes
  both the page and the notch chip; a slow gateway never freezes the
  shell (throttle the connection and try).

Acceptance: the day's traffic reads at a glance, the models that
matter ranked, without leaving the notch.

### 5. Mode 2: the dashboard password

- [ ] The login call (`POST /api/auth/login`), the session cookie
  persisted with the password in the keyring (isled holds both; the
  extension sees derived state only).
- [ ] 401 / expired cookie: log in again, at most once per 60 s —
  never a loop; unauthorized shows in Settings with a red dot, and
  the poll stops.
- [ ] A successful login with the default password ("123456") shows
  the Settings hint to change the gateway's default password.
- [ ] Verify: a remote gateway through a tunnel, cookie persisting
  across sessions, 401 recovery inside 60 s without login spam.

Acceptance: a remote user logs in once and stays connected, and knows
when they are not.

### 6. Mode 3: the proxy key

- [ ] Base URL + Bearer key in Settings under Remote → advanced;
  `GET {PROXY}/notch?period=…` with `Authorization: Bearer <key>`,
  the same Stats shape; the key in the keyring.
- [ ] The README lists the proxy as the option for users who will not
  put a dashboard password in Isle.
- [ ] Verify: the proxy serves numbers identical to the other modes.

Acceptance: the same page and chip, no password stored.

### 7. Fase 2 (optional): the SSE ticker

- [ ] `GET /api/usage/stream` as an event ticker only — its snapshot
  is lifetime usage, not the period's; it triggers a re-fetch of
  `/stats` and nothing more.
- [ ] Verify: a request finishing updates the chip within a second,
  with the poll interval unchanged.

Acceptance: the chip moves the moment a request completes.

### 8. Security and docs

- [ ] SECURITY.md: the password and key live in the keyring only; all
  requests read-only but the login; usage data never sent anywhere
  but the user's own gateway; the default-password hint.
- [ ] The plan's naming rule checked over every string: "LLM Router"
  in Settings, "Router" on the page and notch, the gateway's brand
  nowhere in the UI.
- [ ] product-spec.md gains the Router chip in the compact island's
  status list and the page's row, in the spec's own words.

## Not in this list

Billing, the AI traffic's own streams, configuring the gateway from
Isle, and gateways beyond the trait's one implementation; see the
plan's section 10.
