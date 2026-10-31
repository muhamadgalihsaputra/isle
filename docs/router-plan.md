# Isle × LLM Routers: Usage & Analytics Plan

This document describes how Isle shows the usage and analytics of an
LLM gateway running on this machine or one the user reaches over the
network. The first gateway supported is 9Router
(https://github.com/decolua/9router), the gateway many AI coding tools
(Claude Code, Codex, Cursor…) are pointed at; the work is tracked in
[router-tasks.md](router-tasks.md).

A gateway is optional. Every part of this integration degrades to
nothing when the gateway is missing, unreachable, or unauthorized: no
page keeps its tab, no chip stays on the notch, no error surfaces in the
console. Isle talks to the gateway over HTTP only, and only to the
address the user configured — usage data is never sent anywhere else.

## 1. Why

The island's job is "know when something changes, at a glance" (see
product-spec.md, section 1). For someone routing their AI coding tools
through a gateway, the numbers that change are the gateway's own:
requests, tokens in and out, and what that is estimated to cost. Today
those numbers live in the gateway's dashboard, a browser tab away; this
brings them to the notch, at a glance, with a page for the detail.

The cost the gateway reports is its own **estimate** from public API
prices — never billing. Isle always labels it "est.".

## 2. Naming

- UI strings (Settings, page title, notch label): **"LLM Router"** in
  Settings, **"Router"** on the page and the notch. The brand of the
  first gateway (9Router) never shows in the UI.
- Code identifiers are gateway-neutral: `routerUsage`, `RouterPage`,
  `RouterService` — never a brand in a name.
- The brand appears only in code comments, this documentation's list
  of supported gateways, and the version-detection string.

## 3. Gateway abstraction

All gateway specifics live behind one trait (Rust: in `isled`; the
extension never speaks HTTP itself — it reads the daemon's state, as it
does for battery, network and GSConnect):

```rust
trait RouterGateway {
    fn id(&self) -> &'static str;              // "9router"
    fn connect(&self) -> Result<Connected>;   // auth settled, version known
    fn stats(&self, period: Period) -> Stats;  // requests, tokens, est. cost, by model, recent
    fn auth_mode(&self) -> AuthMode;          // LocalToken | Password | ProxyKey
}
```

Adding another gateway later (omniroute, another) means one more
implementation of this trait and a Settings entry — no page, chip or
poll loop changes. For now exactly one implementation exists: 9Router.

## 4. Settings

Settings → LLM Router, one panel:

- **Connection** (radio):
  - **Local — Same Machine** (default): zero input. Isle looks for the
    gateway at `http://localhost:20128`; when it is not there, the
    status line says so and the Remote option is a click away.
  - **Remote — VPS / Server**: Base URL + auth method (radio):
    - **Dashboard password** (default)
    - **Proxy key** (advanced)
- **Period**: today (default) / 24h / 7d — the notch and the page both
  follow it; the page header can change it too.
- **Show on the notch** (toggle): the compact chip below.
- **Status line**: connected + the gateway's version, or
  "unauthorized", or "unreachable".

## 5. Authentication

Three technical modes sit behind the two options above.

### Mode 1 — local CLI token (the Local option)

9Router keeps credentials for CLIs on the same machine in its data
directory; Isle reads them and derives the same token its CLI does:

- `machineId` from `~/.9router/data/machine-id` (fallback:
  `~/.9router/machine-id`)
- `cliSecret` from `~/.9router/data/auth/cli-secret`
- token = first 16 hex chars of `sha256(machineId + "9r-cli-auth" + cliSecret)`

Every usage request sends `x-9r-cli-token: <token>`. This is 9Router's
own mechanism for same-machine CLIs (verified on 0.5.112). On 401 the
settings offer the Remote flow at the same localhost URL with a
dashboard password — Mode 2 — as the fallback.

### Mode 2 — dashboard password (the Remote option's default)

`POST {BASE}/api/auth/login` with `{"password": "…"}`; the gateway sets
a session cookie (JWT), which is persisted in the keyring with the
password (see Security). A 401 or an expired cookie logs in again, at
most once per 60 seconds — the gateway rate-limits logins per IP, so
Isle never retries in a loop.

### Mode 3 — proxy key (the Remote option's advanced path)

Some users will not put a dashboard password in Isle at all. A tiny
open-source proxy (single Node file, linked from the README) holds the
password and serves `GET {PROXY}/notch?period=…` with
`Authorization: Bearer <key>`. Isle knows nothing about the proxy's
implementation; the data it returns is the same shape as the other
modes. (For 9Router, the proxy relays the same usage endpoints with the
session it maintains.)

## 6. Endpoints (9Router's API)

Without auth:

- `GET /api/version` → `{currentVersion, latestVersion, hasUpdate}`.
  `currentVersion` below 0.4.42 shows a permanent warning
  ("Update your gateway first") — 9Router's old usage endpoint once
  leaked API keys; below that version Isle does not fetch usage at all.

With the Mode 1 or 2 auth:

- `GET /api/usage/stats?period=today|24h|7d|30d|60d|all` →
  `totalRequests`, `totalPromptTokens`, `totalCompletionTokens`,
  `totalCachedTokens`, `totalCost` (the estimate, always "est."), a
  `byModel` map, `recentRequests`, `activeRequests`, `pending`.

Fase 2, optional: `GET /api/usage/stream` (SSE) as an event ticker —
its snapshot is lifetime usage, not the period's, so it only triggers a
re-fetch of `/stats`. Until then, and regardless: poll `/stats` every
10–15 s while the island shows it, never on a timer when it does not.

## 7. What shows, and where

### Compact notch

`▲ 369 · $2.21 est · glm-5.3` — requests in the period, estimated cost,
the busiest model — plus a status dot: green connected, grey offline,
red unauthorized. A small pulse while `activeRequests` is not empty.
The chip joins `_spreadStatuses` like every other status; with the
notch toggle off, it is not there.

### Page

- A summary card: requests, tokens in/out/cached, estimated cost, for
  the active period.
- Top 5 models by tokens: horizontal bars, compact numbers (1.2M,
  845K).
- The last 10 requests: model, in→out tokens, ok/error, relative time
  ("2m ago"), scrollable.
- The period toggle in the header, kept in step with Settings.

Numbers are compact everywhere; the cost always carries "est.".

## 8. Error handling

- **401**: Mode 1 falls back to offering Mode 2 at the same URL; Modes
  2 and 3 show "unauthorized" in Settings, a red dot, and stop. No
  loops.
- **Unreachable / 5xx**: grey dot, backoff 2 s → 5 s → 15 s → 60 s
  (cap). Recovery is automatic when the gateway returns, without a
  restart.
- **Timeout**: 10 s. One request in flight per endpoint.
- All HTTP is async (isled's agent, off the main loop); the extension
  re-renders at most once a second, and keeps no large response
  strings longer than the render needs.

## 9. Security

- The password and the proxy key live in the keyring only — never in
  gsettings, never in a file in the clear, never in logs, never in the
  clipboard history, never in any telemetry. isled holds them, as it
  holds the AIs' own credentials; the extension only ever sees
  derived state.
- Every request is read-only except the single login call.
- Usage data never leaves the user's own gateway.
- A successful login with 9Router's default password ("123456") shows a
  hint in Settings to change the gateway's default password.

## 10. Out of scope

- Billing (the gateway's numbers are estimates only)
- Streaming responses of the AI traffic itself
- Configuring the gateway from Isle (its own dashboard does that)
- Other gateways' implementations beyond the trait above
