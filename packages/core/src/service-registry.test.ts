import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import type { ServiceStatus } from "./types.js";

const TEST_PORT = 45127; // distinct from the other test files' ports

let server: net.Server | null = null;
let registry: ServiceRegistry | null = null;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = net.createServer();
    server.listen(TEST_PORT, "127.0.0.1", () => resolve());
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    s.close(() => resolve());
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterEach(async () => {
  registry?.stopPolling();
  registry = null;
  await stopServer();
});

describe("ServiceRegistry polling", () => {
  it("notices a service going down and coming back, without any requests", async () => {
    const bus = new LoclynEventBus();
    const statuses: ServiceStatus[] = [];
    bus.on((event) => {
      if (event.type === "service:updated") statuses.push(event.payload.status);
    });

    registry = new ServiceRegistry([{ name: "frontend", type: "frontend", port: TEST_PORT }], bus);

    await startServer();
    await registry.checkAll();
    registry.startPolling(50);

    await stopServer();
    await waitFor(() => statuses.includes("unreachable"));

    await startServer();
    await waitFor(() => statuses.at(-1) === "running");

    expect(statuses).toEqual(["running", "unreachable", "running"]);
  });

  it("stays silent while nothing changes", async () => {
    const bus = new LoclynEventBus();
    let events = 0;
    bus.on((event) => {
      if (event.type === "service:updated") events++;
    });

    registry = new ServiceRegistry([{ name: "frontend", type: "frontend", port: TEST_PORT }], bus);

    await startServer();
    await registry.checkAll();
    registry.startPolling(30);
    await new Promise((r) => setTimeout(r, 300)); // roughly 10 poll rounds

    expect(events).toBe(1); // only the initial starting -> running
  });
});