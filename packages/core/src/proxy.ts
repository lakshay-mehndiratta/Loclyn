import http from "node:http";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import httpProxy from "http-proxy";
import { Router } from "./router.js";
import { LoclynEventBus } from "./event-bus.js";
import type { RequestLogEntry } from "./types.js";

/**
 * The Proxy is a normal Node HTTP server. For every incoming request it:
 *   1. Asks the Router "which service handles this path?"
 *   2. If none found → responds 502 itself (no service to blame).
 *   3. Otherwise, hands the request to `http-proxy`, which does the actual
 *      work of opening a connection to the target and piping bytes both
 *      ways — we don't reimplement HTTP forwarding, we configure it.
 *   4. Emits a `request:logged` event so the event bus (and eventually the
 *      CLI/dashboard) can show what happened.
 *
 * WebSocket ("upgrade") requests are handled the same way, but through
 * Node's separate 'upgrade' event and http-proxy's `.ws()` method — see
 * handleUpgrade() below. Routing is fully shared with normal HTTP requests
 * via the same Router.resolve() call.
 */
export class LoclynProxy {
  private server: http.Server;
  private proxy: httpProxy;
  private sockets = new Set<Socket>();

  constructor(
    private router: Router,
    private bus: LoclynEventBus,
  ) {
    this.proxy = httpProxy.createProxyServer({});
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });

    // Node fires 'upgrade' instead of 'request' when a client is asking to
    // switch this connection to a WebSocket. Without this listener, the
    // connection just hangs — no error, no response, nothing.
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));

    // If the target service itself errors mid-forward (e.g. it crashed
    // between the routing decision and the actual connection), http-proxy
    // emits 'error' instead of throwing — handle it so Loclyn doesn't crash.
    this.proxy.on("error", (err, _req, res) => {
      if (res instanceof http.ServerResponse && !res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Loclyn: proxy error reaching target — ${err.message}`);
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const startedAt = Date.now();
    const path = req.url ?? "/";
    const target = this.router.resolve(path);

    if (!target) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Loclyn: no service configured to handle this path");
      return;
    }

    // Once the response finishes, we know status + duration + size —
    // that's when we log the request, not before.
    res.on("finish", () => {
      const entry: RequestLogEntry = {
        id: randomUUID(),
        time: startedAt,
        method: req.method ?? "GET",
        path,
        status: res.statusCode,
        serviceName: target.name,
        type: "fetch",
        sizeBytes: Number(res.getHeader("content-length")) || null,
        durationMs: Date.now() - startedAt,
      };
      this.bus.emit({ type: "request:logged", payload: entry });
    });

    this.proxy.web(req, res, {
      target: `http://127.0.0.1:${target.port}`,
    });
  }

  private handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = req.url ?? "/";
    const target = this.router.resolve(path);

    if (!target) {
      // No service to route the WebSocket to — close the raw socket
      // ourselves, since there's no res object to send a normal HTTP
      // error response through at this point.
      socket.destroy();
      return;
    }

    // Same routing decision as a normal request, just handed to .ws()
    // instead of .web(). http-proxy performs the upgrade handshake against
    // the target and then pipes bytes both ways for as long as the
    // connection stays open.
    this.proxy.ws(req, socket, head, {
      target: `http://127.0.0.1:${target.port}`,
    });

    const entry: RequestLogEntry = {
      id: randomUUID(),
      time: Date.now(),
      method: req.method ?? "GET",
      path,
      status: 101, // "Switching Protocols" — the real status code for a successful WS upgrade
      serviceName: target.name,
      type: "websocket",
      sizeBytes: null, // a WebSocket connection isn't a single sized response
      durationMs: null, // it stays open — there's no "duration" for an open connection
    };
    this.bus.emit({ type: "request:logged", payload: entry });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      // Bind explicitly to the IPv4 loopback address, not "localhost" —
      // on Windows, "localhost" can resolve to the IPv6 loopback (::1)
      // depending on Node/DNS config, which can silently mismatch with
      // what cloudflared tries to connect to. Being explicit here removes
      // that ambiguity entirely.
      this.server.listen(port, "127.0.0.1", () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      // Same reasoning as DashboardServer.close() — open WebSocket
      // connections (e.g. HMR) never end on their own, so force-destroy
      // every open socket before waiting on the server's close callback.
      for (const socket of this.sockets) socket.destroy();
      this.server.close(() => resolve());
    });
  }
}