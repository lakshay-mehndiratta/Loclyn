import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  LoclynEventBus,
  LoclynEvent,
  ServiceState,
  DiagnosticResult,
  ConnectionState,
} from "@loclyn/core";

/**
 * DashboardServer is a pure subscriber to the same LoclynEventBus used by
 * the proxy, registry, diagnostics engine, and tunnel manager — it does
 * not touch any of them directly.
 *
 * It exposes a WebSocket-only API (no HTML/static file serving — that's
 * now the Next.js app's job in packages/dashboard). It keeps a small
 * in-memory snapshot of the LATEST service, diagnostic, and connection
 * state it has seen, because those events only fire once, at the moment
 * they change — a client connecting afterward would otherwise never see
 * them. request:logged is NOT snapshotted, since it's a stream of past
 * events, not current state.
 */
export class DashboardServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private sockets = new Set<import("node:net").Socket>();

  private latestServices = new Map<string, ServiceState>();
  private latestDiagnostics = new Map<string, DiagnosticResult>();
  private latestConnection: ConnectionState | null = null;

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

    this.broadcast(event);
  }

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