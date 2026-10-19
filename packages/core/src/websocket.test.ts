import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  LoclynEventBus,
  ServiceRegistry,
  Router,
  LoclynProxy,
  DiagnosticsEngine,
} from "./index.js";
import type { DiagnosticResult, RequestLogEntry, WebSocketConnection } from "./types.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function startProxy(servicePort: number, proxyPort: number) {
  const bus = new LoclynEventBus();
  const registry = new ServiceRegistry(
    [{ name: "frontend", type: "frontend", port: servicePort }],
    bus,
  );
  const proxy = new LoclynProxy(new Router(registry), bus);
  new DiagnosticsEngine(bus);

  const connections: WebSocketConnection[] = [];
  const logs: RequestLogEntry[] = [];
  const diagnostics: DiagnosticResult[] = [];
  bus.on((event) => {
    if (event.type === "websocket:updated") connections.push(event.payload);
    if (event.type === "request:logged" && event.payload.type === "websocket") {
      logs.push(event.payload);
    }
    if (event.type === "diagnostic:updated" && event.payload.id === "websocket-hmr") {
      diagnostics.push(event.payload);
    }
  });

  await proxy.listen(proxyPort);
  cleanups.push(() => proxy.close());
  return { connections, logs, diagnostics };
}

describe("WebSocket lifecycle through the proxy", () => {
  it("reports connecting → open → closed for a healthy WebSocket", async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    await new Promise<void>((r) => server.listen(45128, "127.0.0.1", r));
    cleanups.push(() => {
      wss.clients.forEach((c) => c.terminate());
      wss.close();
      server.close();
    });

    const { connections, logs, diagnostics } = await startProxy(45128, 45129);

    const client = new WebSocket("ws://127.0.0.1:45129/hmr");
    await new Promise<void>((r) => client.on("open", () => r()));
    await waitFor(() => connections.some((c) => c.status === "open"));

    client.close();
    await waitFor(() => connections.some((c) => c.status === "closed"));

    expect(connections.map((c) => c.status)).toEqual(["connecting", "open", "closed"]);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe(101);
    expect(diagnostics.at(-1)?.severity).toBe("ok");
  });

  it("reports failed (and a warning diagnostic) when the service refuses the upgrade", async () => {
    // A plain HTTP server with no WebSocket support answers normally
    // instead of upgrading.
    const server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end("no websockets here");
    });
    await new Promise<void>((r) => server.listen(45130, "127.0.0.1", r));
    cleanups.push(() => {
      server.closeAllConnections();
      server.close();
    });

    const { connections, logs, diagnostics } = await startProxy(45130, 45131);

    const client = new WebSocket("ws://127.0.0.1:45131/hmr");
    client.on("error", () => {});
    await waitFor(() => connections.some((c) => c.status === "failed"));

    const failed = connections.find((c) => c.status === "failed");
    expect(failed?.reason).toContain("404");
    expect(logs[0].status).toBe(404);
    expect(diagnostics.at(-1)?.severity).toBe("warning");
  });

  it("reports failed when the service is not running", async () => {
    // Nothing is listening on 45132.
    const { connections, logs } = await startProxy(45132, 45133);

    const client = new WebSocket("ws://127.0.0.1:45133/hmr");
    client.on("error", () => {});
    await waitFor(() => connections.some((c) => c.status === "failed"));

    const failed = connections.find((c) => c.status === "failed");
    expect(failed?.reason).toContain("ECONNREFUSED");
    expect(logs[0].status).toBe(502);
  });
});