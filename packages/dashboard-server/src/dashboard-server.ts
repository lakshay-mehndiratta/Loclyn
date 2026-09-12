import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  LoclynEventBus,
  LoclynEvent,
  ServiceState,
  DiagnosticResult,
  ConnectionState,
  RequestLogEntry,
} from "@loclyn/core";

const MAX_REQUEST_HISTORY = 200;

/**
 * DashboardServer is a pure subscriber to the same LoclynEventBus used by
 * the proxy, registry, diagnostics engine, and tunnel manager — it does
 * not touch any of them directly.
 *
 * It exposes a WebSocket-only API. It keeps a small in-memory snapshot of
 * the LATEST service, diagnostic, and connection state (each represents
 * current state — one true answer per key) plus a CAPPED, MOST-RECENT
 * request history (requests are individual past events, not state, so we
 * keep a bounded ring buffer rather than "the one true value").
 *
 * This snapshot is entirely in-memory and is lost if the CLI process
 * itself restarts — it is not persisted to disk. It only protects against
 * a browser tab reconnecting (page refresh, new tab, brief disconnect),
 * which is the common case this was built for.
 */
export class DashboardServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private sockets = new Set<import("node:net").Socket>();

  private latestServices = new Map<string, ServiceState>();
  private latestDiagnostics = new Map<string, DiagnosticResult>();
  private latestConnection: ConnectionState | null = null;
  // Most recent first, capped at MAX_REQUEST_HISTORY.
  private recentRequests: RequestLogEntry[] = [];

  constructor(private bus: LoclynEventBus) {
    this.server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });

    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });
    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      this.sendSnapshot(socket);
    });

    this.bus.on((event) => this.handleEvent(event));
  }

  private handleEvent(event: LoclynEvent): void {
    if (event.type === "service:updated") {
      this.latestServices.set(event.payload.name, event.payload);
    }
    if (event.type === "diagnostic:updated") {
      this.latestDiagnostics.set(event.payload.id + event.payload.detail, event.payload);
    }
    if (event.type === "connection:updated") {
      this.latestConnection = event.payload;
    }
    if (event.type === "request:logged") {
      this.recentRequests.unshift(event.payload);
      if (this.recentRequests.length > MAX_REQUEST_HISTORY) {
        this.recentRequests.length = MAX_REQUEST_HISTORY;
      }
    }

    this.broadcast(event);
  }

  /** Sends every currently-known service, diagnostic, and connection
   * state, plus the recent request history, to one newly connected
   * client — as normal LoclynEvent messages. The browser side doesn't
   * need to know this is a "replay," it just looks like a burst of the
   * same event types it already handles. Requests are replayed oldest
   * first, so the client's own most-recent-first prepend logic ends up
   * with them in the correct final order. */
  private sendSnapshot(socket: WebSocket): void {
    for (const service of this.latestServices.values()) {
      this.sendTo(socket, { type: "service:updated", payload: service });
    }
    for (const diagnostic of this.latestDiagnostics.values()) {
      this.sendTo(socket, { type: "diagnostic:updated", payload: diagnostic });
    }
    if (this.latestConnection) {
      this.sendTo(socket, { type: "connection:updated", payload: this.latestConnection });
    }
    for (const request of [...this.recentRequests].reverse()) {
      this.sendTo(socket, { type: "request:logged", payload: request });
    }
  }

  private sendTo(socket: WebSocket, event: LoclynEvent): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }

  private broadcast(event: LoclynEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, "127.0.0.1", () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) client.terminate();
      for (const socket of this.sockets) socket.destroy();
      this.server.close(() => resolve());
    });
  }
}