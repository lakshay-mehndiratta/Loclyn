import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { LoclynEventBus, LoclynEvent } from "@loclyn/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/server/dashboard-server.js -> ../../public (back to the package root, then into public/)
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
};

/**
 * DashboardServer is a pure subscriber to the same LoclynEventBus used by
 * the proxy, registry, and diagnostics engine — it does not touch any of
 * them directly. It only:
 *   1. Serves the static dashboard files (index.html, style.css, app.js)
 *   2. Accepts WebSocket connections from that page
 *   3. Forwards every LoclynEvent it sees on the bus out to all connected
 *      browser tabs, as JSON text messages
 *
 * This is the same "one seam, no ripple effects" pattern used for
 * DiagnosticsEngine — nothing in core changes to support this.
 */
export class DashboardServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(private bus: LoclynEventBus) {
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });

    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
    });

    // The single integration point: forward every event from the shared
    // bus out to every connected browser tab.
    this.bus.on((event) => this.broadcast(event));
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