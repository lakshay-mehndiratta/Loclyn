# Loclyn

Loclyn exposes your local development stack — a frontend, a backend, or both — to any device through a single public URL, and tells you **why** something broke when it does. It's built for the recurring pain of testing a local web app on a real phone: mismatched ports, CORS errors, dev servers that reject the tunnel's hostname, broken HMR WebSockets, and redirects that point back at `localhost`.

```
Phone ──▶ Cloudflare Tunnel ──▶ Loclyn Proxy ──▶ your local frontend
                                      │
                                      └──▶ your local backend (if separate)
```

## Quick start

```bash
# 1. Start your own dev server(s) as usual, e.g. npm run dev
# 2. In another terminal, from your project folder:
npx loclyn --frontend 3000
```

Loclyn prints a public `https://….trycloudflare.com` URL — open it on your phone. Open **http://localhost:4021** on your computer for the live dashboard. The dashboard is served by Loclyn itself, so there is no second process to start.

## Why

Tunneling tools like ngrok or Cloudflare Tunnel give you a public URL for one port. They don't route a multi-service stack under one URL, and they don't explain failures once traffic starts flowing. Loclyn sits between the tunnel and your dev servers, routes each request to the right service, and runs a diagnostics engine that classifies real failures instead of guessing.

## Features

- **One URL for the whole stack** — a Cloudflare quick tunnel (no account needed) in front of a proxy that routes by path prefix to a frontend and one or more backends.
- **HTTP and WebSocket proxying** — HMR and other WebSockets go through the same routing as normal requests. Loclyn tracks the real handshake outcome (accepted, refused, or unreachable).
- **Diagnostics that explain the cause** — each finding names the affected service and the fix, and is labeled **high** or **medium** confidence (see below).
- **Live dashboard** — Overview, Services, Requests, WebSockets, Diagnostics, Logs and a read-only Settings page, updating in real time and surviving a page refresh. Served by Loclyn on the dashboard port.
- **Flexible setup** — CLI flags, a `.loclyn.json` config file, or auto-detection from your project.
- **Clean lifecycle** — graceful shutdown on `Ctrl+C`, and clear errors when a port is in use or `cloudflared` is missing.

## Prerequisites

- **Node.js 20 or newer** (`node -v` to check).
- **[`cloudflared`](https://github.com/cloudflare/cloudflared)** installed and on your `PATH`. Loclyn uses it to open a free Cloudflare quick tunnel; no Cloudflare account is needed.

  ```bash
  brew install cloudflared                      # macOS
  winget install --id Cloudflare.cloudflared    # Windows (then open a new terminal)
  ```
  Linux and other platforms: see the [downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
- Your own dev server(s) must already be running. Loclyn proxies to them; it doesn't start them.

## Usage

Run `loclyn` from your project folder — it reads `.loclyn.json` and `package.json` from the current directory.

```bash
# Separate frontend + backend: /api/* goes to the backend, everything else to the frontend
npx loclyn --frontend 5173 --backend 4000

# A single full-stack app (Next.js, etc.)
npx loclyn --frontend 3000

# No flags: use .loclyn.json, or detect your project and ask you to confirm
npx loclyn

# Same, but skip the confirmation prompt
npx loclyn --yes
```

| Option | Meaning |
|---|---|
| `--frontend <port>` | The frontend (or your only server, for a full-stack app). This is the catch-all service. |
| `--backend <port>` | A separate backend; requests under `/api` are routed to it. |
| `--proxy-port <port>` | Loclyn's proxy port (default `4020`) |
| `--dashboard-port <port>` | Dashboard and data-socket port (default `4021`) |
| `-y`, `--yes` | Accept detected settings without prompting |
| `-h`, `--help` | Show help |

On startup Loclyn prints the proxy address, the dashboard address and, once connected, the public device URL. Press `Ctrl+C` to stop.

### Auto-detection

With no `--frontend` and no `.loclyn.json`, Loclyn reads `package.json` in the current folder and its immediate subfolders and recognises:

- **Frontends:** Next.js, Vite, Create React App
- **Backends:** Express, Fastify, Koa, NestJS

Ports come from a `--port` / `-p` flag in your `dev` or `start` script, or the framework default (Next.js and CRA `3000`, Vite `5173`). Backends have no default: if one is detected but its port can't be found, pass `--backend <port>`. If detection is ambiguous or finds nothing, Loclyn explains why and exits instead of guessing.

## Configuration file

Optional. Put a `.loclyn.json` in the folder you run Loclyn from:

```json
{
  "proxyPort": 4020,
  "dashboardPort": 4021,
  "services": [
    { "name": "web", "type": "frontend", "port": 5173, "framework": "Vite" },
    { "name": "api", "type": "backend", "port": 4000, "pathPrefix": "/api", "framework": "Express" }
  ]
}
```

- `services` is required. Each entry needs `name` (unique), `type` (`frontend` or `backend`) and `port`; `pathPrefix` and `framework` are optional. `framework` is only a label.
- A service with a `pathPrefix` (like `/api`) only receives matching requests. At most one service may omit it — that's the catch-all for everything else. **If you have no catch-all, requests to `/` return 502**, and the Routing diagnostic will say so.
- A service port can't equal Loclyn's own proxy or dashboard port, and those two must differ.
- Precedence is **CLI flags > `.loclyn.json` > detection / defaults**. If you pass `--frontend`, the services in `.loclyn.json` are ignored; `--proxy-port` and `--dashboard-port` still override the file. The Settings page shows which source each value came from.
- Unknown keys and invalid values are rejected, with every problem listed at once.

## Dashboard

Open `http://localhost:4021` (or your `--dashboard-port`). It updates live and keeps its recent history when you refresh the page.

- **Overview** — connection, services, diagnostics, recent requests
- **Services** — reachability, port, framework, path prefix
- **Requests** — searchable, paginated; unrouted requests appear as `(no route)`
- **WebSockets** — each connection's handshake outcome and lifetime (no message counts — Loclyn doesn't inspect frames)
- **Diagnostics** — every check with confidence and last-updated time
- **Logs** — Loclyn's own events (service, tunnel, diagnostics, WebSocket). It does **not** show your apps' console output, since Loclyn doesn't start your apps.
- **Settings** — effective configuration, read-only

History (200 requests, 100 WebSockets, 300 log lines) lives in memory and resets when Loclyn restarts.

## Diagnostics

| Check | What it tells you | Confidence |
|---|---|---|
| **API Connectivity** | A service isn't accepting connections on its port | High |
| **Tunnel** | `cloudflared` is missing, exited, or the tunnel is up (with an install hint) | High |
| **HTTP Requests** | 500+ responses among a service's last 5 requests (1 = warning, 2 or more = error) | Medium |
| **WebSocket (HMR)** | A WebSocket upgrade was accepted, refused (with the status), or the service was unreachable | High |
| **Connectivity (IPv4/IPv6)** | The proxy's connection was refused — a common sign of a service bound only to IPv6 | Medium |
| **Dev Server Host Check** | Vite or Next is refusing requests that arrive with the tunnel hostname; gives the exact config fix (`allowedHosts` / `allowedDevOrigins`) | High |
| **CORS** | A cross-origin request or preflight came back without a matching `Access-Control-Allow-Origin` | Medium |
| **HTTPS / Mixed Content** | An HTTPS page loads `http://` resources (script, stylesheet, image, iframe, media, CSS `url()`), or a redirect points at `localhost` or downgrades to `http` | Medium |
| **Routing** | A request matched no configured route, with the list of configured routes | High |
| **Port in use** | A required port is taken — reported at startup | High |

**Confidence matters.** *High* means Loclyn observed the failure directly (a probe, a handshake, a routing decision). *Medium* means it inferred the problem from traffic, so the real cause may be in your app.

### How mixed-content detection works

Cloudflare terminates TLS and talks plain HTTP to Loclyn, so the local socket can't tell whether the visitor used HTTPS. Loclyn reads the scheme from `X-Forwarded-Proto`, then `CF-Visitor`, then `Forwarded`. With no signal the page is treated as unknown and not scanned, and an explicit `http` always wins.

For HTTPS pages, Loclyn watches HTML and CSS responses as they stream through (the browser's bytes are not changed) and flags `http://` resources the browser would actually load. Ordinary links (`<a href>`), form actions, `<link rel="canonical">`-style hints, comments, `<script>` text, `<noscript>` and `<template>` content are not flagged.

## Making your stack tunnel-friendly

What the diagnostics usually ask for:

```js
// vite.config.js — let the tunnel hostname through
export default { server: { allowedHosts: [".trycloudflare.com"] } };
```

```js
// next.config.js (Next 16+) — allow dev resources from the tunnel
module.exports = { allowedDevOrigins: ["*.trycloudflare.com"] };
```

```js
// Express — build redirect URLs from the real scheme and host, and enable CORS for your origin
app.set("trust proxy", true);
app.use(cors({ origin: "http://localhost:5173" }));
```

## Troubleshooting

**No public URL / "Tunnel" error on the Diagnostics page.** `cloudflared` is missing or not on your `PATH`. Install it (see Prerequisites), open a new terminal and restart Loclyn.

**"Port … is already in use" on startup.** Another process — often an earlier Loclyn — is using `4020` or `4021`. Stop it, or choose other ports with `--proxy-port` / `--dashboard-port`.

**Loclyn says nothing is listening on your service's port.** Start your dev server first, and check you gave Loclyn the right port.

**A service shows unreachable, or "connection refused" although it is running.** The server is probably bound to IPv6 only. Bind it to IPv4 (for Vite, `--host 127.0.0.1`).

**The page works on your computer but not on the phone, or HMR doesn't connect.** The dev server may be rejecting the tunnel hostname. The *Dev Server Host Check* diagnostic names the fix; see "Making your stack tunnel-friendly".

**A request returns 502 "no route".** No service matched it. Add a catch-all service (no `pathPrefix`) or the missing prefix. Note that Cloudflare replaces origin 5xx responses with its own "Bad gateway" page on the public URL; the exact reason is on the dashboard's Diagnostics and Requests pages, or by opening `http://localhost:4020` directly.

**CORS warning.** Allow the origin of the page the phone actually loaded (the tunnel URL), not just `localhost`.

**Mixed-content warning.** Change the named `http://` URL to `https://` or to a relative URL, or make your server build redirects from the forwarded scheme and host (`trust proxy` in Express).

**`Invalid .loclyn.json`.** Every problem is listed; fix them and run again.

**Running from source: the dashboard says "not built yet".** Run `npm run build` from the repository root.

## Security notes

- The tunnel URL is **public**: anyone who has it can reach your dev servers while Loclyn is running. Use it for development only, and stop Loclyn (`Ctrl+C`) when you're done.
- Loclyn's proxy and dashboard listen on `127.0.0.1` only. Other devices reach your app through the tunnel URL, not your LAN address, and the dashboard is available only on your own computer.
- Quick-tunnel URLs are random and change on every restart.

## Architecture

```
packages/
├── core/              Registry, router, proxy (HTTP + WebSocket), diagnostics, tunnel manager, config
├── cli/               The `loclyn` command — flags, config, detection, wiring (published to npm as `loclyn`)
├── dashboard-server/  Serves the dashboard and a WebSocket data API (/ws); mirrors the event bus
└── dashboard/         Next.js UI, built to static files and served by dashboard-server
```

Everything in `core` communicates through one typed event bus (`LoclynEventBus`). The proxy, service registry, tunnel manager and analyzers emit events; the terminal output, the log collector, and the dashboard are subscribers to the same stream. `DiagnosticsEngine` attaches the CORS, mixed-content and routing analyzers itself, so they can't be left unwired.

The dashboard server keeps a bounded in-memory snapshot (recent requests, WebSockets, logs, latest settings) and replays it to any client that connects, which is why a page refresh keeps its state. The published `loclyn` package bundles `core` and `dashboard-server` into the CLI and ships the built dashboard alongside it.

## Development

```bash
git clone https://github.com/lakshay-mehndiratta/Loclyn.git
cd Loclyn
npm install
npm run build      # core → dashboard-server → cli → dashboard, in this order
npm test

node packages/cli/dist/index.js --frontend 3000
```

After changing code, rebuild in that order and **restart** Loclyn — a stale `dist/` or an old process makes fixed bugs look unfixed. For dashboard work, `npm run dev -w @loclyn/dashboard` serves it on `http://localhost:3001` and connects to Loclyn's data socket on port 4021 (set `NEXT_PUBLIC_LOCLYN_WS_URL` to override).

Tests use [Vitest](https://vitest.dev). Routing, config parsing, analyzers and the HTML/CSS scanner are unit-tested with no servers. Proxy behavior is tested against real temporary servers: WebSocket handshakes, CORS and redirect observation, unrouted requests, mixed content (HTTPS vs HTTP pages, non-HTML responses, gzip/brotli, streaming), the static dashboard, and the dashboard snapshot replay.

## Known limitations

- Quick tunnels are disposable — the public URL changes on every restart. No custom domains yet.
- Dashboard history lives in memory and resets when Loclyn restarts.
- **Mixed content** only sees what the server sends. Resources injected by JavaScript at runtime, hardcoded URLs inside JS bundles, and `<base href>` are invisible to it. On a Vite or React SPA it covers the `index.html` shell and CSS files. It also relies on the tunnel supplying a scheme header (`X-Forwarded-Proto` or `CF-Visitor`); without one, pages aren't scanned.
- **CORS** is judged from the headers crossing the proxy, not from the browser's own verdict, and calls made straight to `localhost:<port>` (bypassing Loclyn) are never seen.
- **Routing** stays a warning until Loclyn restarts, since a missing route is an event and not a state it can later observe as fixed.
- Connection-refused detection (IPv4/IPv6) is a heuristic, not a certainty.
- There is no `loclyn init` command yet; create `.loclyn.json` by hand.

## License

MIT
