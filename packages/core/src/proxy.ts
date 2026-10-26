import http from "node:http";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import httpProxy from "http-proxy";
import { Router } from "./router.js";
import { LoclynEventBus } from "./event-bus.js";
import type { RequestLogEntry, WebSocketConnection, CorsObservation } from "./types.js";
import { classify_Response } from "./classify.js";

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
  // Tracks each in-flight WebSocket by its request object. A WeakMap lets
  // entries disappear automatically once the request is garbage collected.
  private wsConnections = new WeakMap<http.IncomingMessage, WebSocketConnection>();
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

    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));

    // http-proxy fires 'proxyReqWs' once it has built the outgoing request
    // to the service. We watch that request for the real handshake outcome.
    this.proxy.on("proxyReqWs", (proxyReq, req) => {
      const conn = this.wsConnections.get(req);
      if (!conn) return;

      // The service accepted the upgrade: the WebSocket is truly open.
      proxyReq.on("upgrade", (_res, proxySocket) => {
        this.openWebSocket(conn);
        proxySocket.once("close", () => this.closeWebSocket(conn));
      });

      // The service answered with a normal HTTP response instead of
      // upgrading: it refused the WebSocket.
      proxyReq.on("response", (res) => {
        const status = res.statusCode ?? 502;
        this.failWebSocket(conn, `service answered ${status} instead of upgrading`, status);
      });

      // We couldn't reach the service at all.
      proxyReq.on("error", (err) => {
        const code = (err as NodeJS.ErrnoException).code ?? err.message;
        this.failWebSocket(conn, `could not reach service (${code})`, 502);
      });
    });

    // If the target service itself errors mid-forward (e.g. it crashed
    // between the routing decision and the actual connection), http-proxy
    // emits 'error' instead of throwing — handle it so Loclyn doesn't crash.
    this.proxy.on("error", (err, req, res) => {
      if (res instanceof http.ServerResponse && !res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Loclyn: proxy error reaching target — ${err.message}`);
      }

      // Surface the raw failure on the bus too, so DiagnosticsEngine can
      // pattern-match on it (e.g. ECONNREFUSED). We only know the error
      // code and which service we were trying to reach — not *why* the
      // connection was refused, so this is reported as a hypothesis, not
      // a confirmed cause, by whoever consumes it.
      const path = req && "url" in req ? (req as http.IncomingMessage).url ?? "/" : "/";
      const target = this.router.resolve(path);
      if (target) {
        const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
        this.bus.emit({
          type: "proxy:forward-error",
          payload: { serviceName: target.name, port: target.port, code, time: Date.now() },
        });
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

    // Capture only the allowlisted CORS-relevant request headers up front.
    const originHeader = req.headers.origin;
    const hostHeader = req.headers.host ?? "";
    const isPreflight = req.method === "OPTIONS" && typeof req.headers["access-control-request-method"] === "string";

    // Once the response finishes, we know status + duration + size —
    // that's when we log the request, not before.
    res.on("finish", () => {
      if (typeof originHeader === "string") {
        const allow = res.getHeader("access-control-allow-origin");
        const observation: CorsObservation = {
          serviceName: target.name,
          method: req.method ?? "GET",
          path: path.split("?")[0],
          status: res.statusCode,
          origin: originHeader,
          host: hostHeader,
          isPreflight,
          allowOrigin: typeof allow === "string" ? allow : null,
          time: startedAt,
        };
        this.bus.emit({ type: "cors:observed", payload: observation });
      }

      const contentType = res.getHeader("content-type");
      const entry: RequestLogEntry = {
        id: randomUUID(),
        time: startedAt,
        method: req.method ?? "GET",
        path,
        status: res.statusCode,
        serviceName: target.name,
        type: classify_Response(typeof contentType === "string" ? contentType : undefined, path),
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
      // ourselves, since there is no res object to send an error through.
      socket.destroy();
      return;
    }

    const conn: WebSocketConnection = {
      id: randomUUID(),
      serviceName: target.name,
      path,
      status: "connecting",
      startedAt: Date.now(),
      openedAt: null,
      closedAt: null,
    };
    this.wsConnections.set(req, conn);
    this.emitWebSocket(conn);

    // The browser hung up. Before the handshake finished that's a failure;
    // after it, a normal close.
    socket.once("close", () => {
      if (conn.status === "connecting") {
        this.failWebSocket(conn, "client disconnected before the upgrade finished", 499);
      } else {
        this.closeWebSocket(conn);
      }
    });

    this.proxy.ws(req, socket, head, {
      target: `http://127.0.0.1:${target.port}`,
    });
  }

  // Each transition only fires from the state it expects, so a connection
  // can never be reported open twice or closed after it failed.
  private openWebSocket(conn: WebSocketConnection): void {
    if (conn.status !== "connecting") return;
    conn.status = "open";
    conn.openedAt = Date.now();
    this.emitWebSocket(conn);
    this.logWebSocket(conn, 101); // 101 Switching Protocols — a real success now
  }

  private closeWebSocket(conn: WebSocketConnection): void {
    if (conn.status !== "open") return;
    conn.status = "closed";
    conn.closedAt = Date.now();
    this.emitWebSocket(conn);
  }

  private failWebSocket(conn: WebSocketConnection, reason: string, httpStatus: number): void {
    if (conn.status !== "connecting") return;
    conn.status = "failed";
    conn.closedAt = Date.now();
    conn.reason = reason;
    this.emitWebSocket(conn);
    this.logWebSocket(conn, httpStatus);
  }

  private emitWebSocket(conn: WebSocketConnection): void {
    // Send a copy so later changes to `conn` never alter delivered events.
    this.bus.emit({ type: "websocket:updated", payload: { ...conn } });
  }

  private logWebSocket(conn: WebSocketConnection, status: number): void {
    const entry: RequestLogEntry = {
      id: randomUUID(),
      time: conn.startedAt,
      method: "GET",
      path: conn.path,
      status,
      serviceName: conn.serviceName,
      type: "websocket",
      sizeBytes: null,
      durationMs: null,
    };
    this.bus.emit({ type: "request:logged", payload: entry });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // If the port is already taken, Node emits 'error' (with
      // err.code === "EADDRINUSE") instead of ever calling the listen
      // callback — without this handler, listen() would hang forever
      // with no explanation. We listen for 'error' just for this one
      // startup attempt, then remove it once bound, so it doesn't
      // interfere with later runtime errors on this same server.
      const onError = (err: NodeJS.ErrnoException) => {
        this.server.off("error", onError);
        if (err.code === "EADDRINUSE") {
          reject(new Error(`Port ${port} is already in use.`));
        } else {
          reject(err);
        }
      };

      this.server.once("error", onError);

      // Bind explicitly to the IPv4 loopback address, not "localhost" —
      // on Windows, "localhost" can resolve to the IPv6 loopback (::1)
      // depending on Node/DNS config, which can silently mismatch with
      // what cloudflared tries to connect to. Being explicit here removes
      // that ambiguity entirely.
      this.server.listen(port, "127.0.0.1", () => {
        this.server.off("error", onError);
        resolve();
      });
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