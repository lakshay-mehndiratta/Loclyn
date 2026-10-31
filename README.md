# Loclyn

Loclyn exposes your local development stack — a frontend, a backend, or both — to any device through a single public URL, and tells you **why** something broke when it does. It's built for the recurring pain of testing a local web app on a real phone: mismatched ports, CORS errors, dev servers that reject the tunnel's hostname, broken HMR WebSockets, and redirects that point back at `localhost`.

```
Phone ──▶ Cloudflare Tunnel ──▶ Loclyn Proxy ──▶ your local frontend
                                      │
                                      └──▶ your local backend (if separate)
```

## Why

Tunneling tools like ngrok or Cloudflare Tunnel give you a public URL for one port. They don't route a multi-service stack under one URL, and they don't explain failures once traffic starts flowing. Loclyn sits between the tunnel and your dev servers, routes each request to the right service, and runs a diagnostics engine that classifies real failures instead of guessing.

## Features

- **One URL for the whole stack** — a Cloudflare quick tunnel (no account needed) in front of a proxy that routes by path prefix to a frontend and one or more backends.
- **HTTP and WebSocket proxying** — HMR and other WebSockets go through the same routing as normal requests. Loclyn tracks the real handshake outcome (accepted, refused, or unreachable).
- **Diagnostics that explain the cause** — each finding names the affected service and the fix, and is labeled **high** or **medium** confidence (see below).
- **Live dashboard** (Next.js) — Overview, Services, Requests, WebSockets, Diagnostics, Logs and a read-only Settings page, updating in real time and surviving a page refresh.
- **Flexible setup** — CLI flags, a `.loclyn.json` config file, or auto-detection from your project.
- **Clean lifecycle** — graceful shutdown on `Ctrl+C`, and clear errors when a port is in use or `cloudflared` is missing.

## Diagnostics

| Check | What it tells you | Confidence |
|---|---|---|
| **API Connectivity** | A service isn't accepting connections on its port | High |
| **Tunnel** | `cloudflared` is missing, exited, or the tunnel is up (with an install hint) | High |
| **HTTP Requests** | A burst of 5xx responses from a service | Medium |
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

## Getting started

**Prerequisites:** Node.js 18+ and [`cloudflared`](https://github.com/cloudflare/cloudflared) on your `PATH`.

```bash
brew install cloudflared                      # macOS
winget install --id Cloudflare.cloudflared    # Windows
```

**Install and build** (build in this order):

```bash
npm install
npm run build -w @loclyn/core
npm run build -w @loclyn/dashboard-server
npm run build -w @loclyn/cli
```

**Run it:**

```bash
# Separate frontend + backend
node packages/cli/dist/index.js --frontend 5173 --backend 3000

# Single full-stack app (Next.js, etc.)
node packages/cli/dist/index.js --frontend 3000

# No flags: Loclyn detects your project from the current folder and asks you to confirm
node packages/cli/dist/index.js

# Skip the confirmation prompt
node packages/cli/dist/index.js --yes
```

| Flag | Meaning |
|---|---|
| `--frontend <port>` | Catch-all frontend service |
| `--backend <port>` | Backend, routed by path prefix |
| `--proxy-port <port>` | Loclyn's proxy port (default `4020`) |
| `--dashboard-port <port>` | Dashboard data server port (default `4021`) |
| `-y`, `--yes` | Accept detected settings without prompting |

This starts the proxy on `localhost:4020`, the dashboard data server on `localhost:4021`, and a Cloudflare quick tunnel that prints a public `https://….trycloudflare.com` URL.

**Run the dashboard UI** in a separate terminal:

```bash
npm run dev --workspace=packages/dashboard
```

Open `http://localhost:3001` for the live UI, and open the tunnel URL on any device. If you use a custom `--dashboard-port`, start the dashboard with `NEXT_PUBLIC_LOCLYN_WS_URL=ws://localhost:<port>/ws`.

## Configuration file

Put a `.loclyn.json` in the folder you run Loclyn from:

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

- `services` is required. Each entry needs `name`, `type` (`frontend` or `backend`) and `port`; `pathPrefix` and `framework` are optional.
- A service with a `pathPrefix` (like `/api`) only receives matching requests. Exactly one service may omit it — that's the catch-all for everything else. **If you have no catch-all, requests to `/` return 502**, and the Routing diagnostic will say so.
- Precedence is **CLI flags > `.loclyn.json` > detection/defaults**. The Settings page shows which source each value came from.
- Invalid configs are rejected with all problems listed at once.

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

## Architecture

```
packages/
├── core/              Registry, router, proxy (HTTP + WebSocket), diagnostics, tunnel manager, config
├── cli/               The `loclyn` command — flags, config, detection, wiring
├── dashboard-server/  WebSocket data API; mirrors the event bus to connected clients
└── dashboard/         Next.js UI that renders live state
```

Everything in `core` communicates through one typed event bus (`LoclynEventBus`). The proxy, service registry, tunnel manager and analyzers emit events; the terminal output, the log collector, and the dashboard are subscribers to the same stream. `DiagnosticsEngine` attaches the CORS, mixed-content and routing analyzers itself, so they can't be left unwired.

The dashboard server keeps a bounded in-memory snapshot (recent requests, WebSockets, logs, latest settings) and replays it to any client that connects, which is why a page refresh keeps its state.

## Dashboard pages

- **Overview** — connection, services, diagnostics, recent requests
- **Services** — reachability, port, framework, path prefix
- **Requests** — searchable, paginated; unrouted requests appear as `(no route)`
- **WebSockets** — each connection's handshake outcome and lifetime (no message counts — Loclyn doesn't inspect frames)
- **Diagnostics** — every check with confidence and last-updated time
- **Logs** — Loclyn's own events (service, tunnel, diagnostics, WebSocket). It does **not** show your apps' console output, since Loclyn doesn't start your apps.
- **Settings** — effective configuration, read-only

## Testing

```bash
npm test --workspace=packages/core
npm test --workspace=packages/dashboard-server
```

Tests use [Vitest](https://vitest.dev). Routing, config parsing, analyzers and the HTML/CSS scanner are unit-tested with no servers. Proxy behavior is tested against real temporary servers: WebSocket handshakes, CORS and redirect observation, unrouted requests, mixed content (HTTPS vs HTTP pages, non-HTML responses, gzip/brotli, streaming) and the dashboard snapshot replay.

## Known limitations

- Quick tunnels are disposable — the public URL changes on every restart. No custom domains yet.
- Dashboard history lives in `dashboard-server`'s memory and resets when the CLI restarts.
- **Mixed content** only sees what the server sends. Resources injected by JavaScript at runtime, hardcoded URLs inside JS bundles, and `<base href>` are invisible to it. On a Vite or React SPA it covers the `index.html` shell and CSS files. It also relies on the tunnel supplying a scheme header (`X-Forwarded-Proto` or `CF-Visitor`); without one, pages aren't scanned.
- **CORS** is judged from the headers crossing the proxy, not from the browser's own verdict, and calls made straight to `localhost:<port>` (bypassing Loclyn) are never seen.
- **Routing** stays a warning until Loclyn restarts, since a missing route is an event and not a state it can later observe as fixed.
- Connection-refused detection (IPv4/IPv6) is a heuristic, not a certainty.
- The dashboard UI is started separately from the CLI, and `loclyn init` and a published `npx loclyn` package don't exist yet.

## License

MIT
