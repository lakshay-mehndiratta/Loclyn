# Loclyn

Loclyn bridges your local development stack — a frontend, a backend, or both — to any device, on any network, through a single URL. It's built for the specific, recurring pain of testing a local web app on a real phone: mismatched ports, CORS errors, broken WebSocket/HMR connections, and dev-server security checks that quietly reject cross-origin traffic. Instead of leaving you with a generic "connection failed," Loclyn tells you what actually broke.

```
Phone ──▶ Cloudflare Tunnel ──▶ Loclyn Proxy ──▶ your local frontend
                                      │
                                      └──▶ your local backend (if separate)
```

## Why

Tunneling tools like ngrok or Cloudflare Tunnel give you a public URL for a single port. They don't route a multi-service stack under one URL, and they don't tell you *why* something failed once traffic starts flowing. Loclyn is built specifically for that gap: it sits between the tunnel and your dev servers, routes requests to the right place, and runs a small diagnostics engine that classifies real failures instead of guessing.

## Features

- **One command, one URL** — `loclyn --frontend <port>` exposes your app publicly via a Cloudflare quick tunnel, no account required.
- **Multi-service routing** — point Loclyn at a separate frontend and backend (`--frontend`/`--backend`) and it routes by path prefix, or run it against a single full-stack app (Next.js, etc.) with just `--frontend`.
- **WebSocket & HMR support** — live reload keeps working through the tunnel; WebSocket upgrades are routed with the same logic as normal HTTP requests.
- **Diagnostics engine** — pattern-matches real traffic and service state into readable diagnostics (service unreachable, HTTP error bursts, WebSocket activity, connection-refused signatures), each explicitly labeled **high** or **medium confidence** depending on whether Loclyn directly observed the failure or inferred it from a pattern.
- **Live dashboard** (Next.js) — Connection status, Services, Diagnostics, and a searchable/paginated Requests log, all updating in real time over a WebSocket, with state that survives a page refresh.
- **Clean process lifecycle** — graceful shutdown on `Ctrl+C`, clear errors (not silent hangs) when a port is already in use.

## Architecture

Loclyn is a monorepo of four packages, each with a single responsibility:

```
packages/
├── core/               Registry, router, proxy (HTTP + WebSocket), diagnostics engine, tunnel manager
├── cli/                 loclyn command — parses flags, wires everything together
├── dashboard-server/     WebSocket-only data API; mirrors Loclyn's internal event bus to any connected client
└── dashboard/            Next.js UI that connects to dashboard-server and renders live state
```

Everything inside `core` communicates through one typed event bus (`LoclynEventBus`). The proxy, service registry, diagnostics engine, and tunnel manager all emit events onto it; the CLI's terminal output and the dashboard's live UI are both just subscribers to that same stream. Nothing downstream needed to change when the dashboard moved from a hand-rolled vanilla JS page to a full Next.js app — the event contract stayed the same.

## Getting started

**Prerequisites:** Node.js 18+, and [`cloudflared`](https://github.com/cloudflare/cloudflared) installed and on your `PATH`.

```bash
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/dashboard-server
npm run build --workspace=packages/cli
```

**Run it**, pointed at your own dev servers:

```bash
# Separate frontend + backend
node packages/cli/dist/index.js --frontend 5173 --backend 3000

# Single full-stack app (Next.js, etc.) — no separate backend
node packages/cli/dist/index.js --frontend 3000
```

This starts:
- Loclyn's proxy on `localhost:4020`
- `dashboard-server` on `localhost:4021`
- A Cloudflare quick tunnel, printing a public `https://….trycloudflare.com` URL once connected

**Run the dashboard** (separate terminal):

```bash
npm run dev --workspace=packages/dashboard
```

Open `http://localhost:3001` for the live UI, or open the printed tunnel URL directly on any device.

## Diagnostics — what's real, and what isn't

Every diagnostic in Loclyn is tagged with a confidence level, and that distinction is load-bearing, not decorative:

| Confidence | Meaning |
|---|---|
| **High** | Directly observed by Loclyn — a TCP probe succeeded/failed, a WebSocket upgrade was forwarded. |
| **Medium** | Inferred from a pattern in recent traffic (e.g. a burst of failed requests). The real cause could be outside Loclyn — a bug in your app, not the proxy. |

Currently implemented: service reachability, HTTP error-rate patterns, WebSocket/HMR presence, connection-refused detection (a common signature of an IPv4/IPv6 binding mismatch), and clean startup failure when a required port is already in use.

## Testing

```bash
npm run test --workspace=packages/core
npm run test --workspace=packages/dashboard-server
```

Routing decisions and diagnostic logic are covered by unit tests with no real servers involved (`router.test.ts`, `diagnostics.test.ts`); port-binding failure handling is tested against real, temporary sockets (`proxy.test.ts`, `dashboard-server.test.ts`).

## Known limitations

- Cloudflare quick tunnels are disposable — the public URL changes every time Loclyn restarts. No persistent/custom domain support yet.
- Dashboard history (services, diagnostics, recent requests) lives in `dashboard-server`'s memory only — it resets if the CLI process restarts, and isn't written to disk.
- No stack auto-detection or config file yet — ports are passed as CLI flags on every run.
- CORS and mixed-content diagnostics aren't implemented yet; connection-refused detection is a heuristic (medium confidence), not a certainty.

## License

MIT
