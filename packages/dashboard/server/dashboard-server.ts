import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { LoclynEventBus, LoclynEvent, ServiceState, DiagnosticResult } from "@loclyn/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
};

/**
 * DashboardServer is a pure subscriber to the same LoclynEventBus used by
 * the proxy, registry, and diagnostics engine — it does not touch any of
 * them directly.
 *
 * It keeps a small in-memory snapshot of the LATEST service and diagnostic
 * state it has seen (keyed by name/id), because service:updated and the
 * startup diagnostic:updated events only fire once, at the moment they
 * change — a browser tab that connects afterward would otherwise never
 * see them. request:logged is NOT snapshotted, since it represents a
 * stream of individual past events, not current state — a newly connected
 * tab reasonably starts with an empty request log and just sees new ones
 * as they happen.
 */
export class DashboardServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  private latestServices = new Map<string, ServiceState>();
  private latestDiagnostics = new Map<string, DiagnosticResult>();

  constructor(private bus: LoclynEventBus) {
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });

    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      this.sendSnapshot(socket);
    });

    this.bus.on((event) => this.handleEvent(event));
  }

  private handleEvent(event: LoclynEvent): void {
    // Track latest state before broadcasting, so any client connecting
    // later (even a split second later) has this in its snapshot.
    if (event.type === "service:updated") {
      this.latestServices.set(event.payload.name, event.payload);
    }
    if (event.type === "diagnostic:updated") {
      this.latestDiagnostics.set(event.payload.id + event.payload.detail, event.payload);
    }

    this.broadcast(event);
  }

  /** Sends every currently-known service and diagnostic to one newly
   * connected client, as normal LoclynEvent messages — the browser side
   * doesn't need to know this is a "replay," it just looks like a burst
   * of the same event types it already knows how to handle. */
  private sendSnapshot(socket: WebSocket): void {
    for (const service of this.latestServices.values()) {
      this.sendTo(socket, { type: "service:updated", payload: service });
    }
    for (const diagnostic of this.latestDiagnostics.values()) {
      this.sendTo(socket, { type: "diagnostic:updated", payload: diagnostic });
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

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const urlPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
    const filePath = path.join(PUBLIC_DIR, urlPath);
    const ext = path.extname(filePath);

    try {
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "text/plain" });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}