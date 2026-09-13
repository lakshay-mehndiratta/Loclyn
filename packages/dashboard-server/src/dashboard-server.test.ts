import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { LoclynEventBus } from "@loclyn/core";
import { DashboardServer } from "./dashboard-server.js";

const TEST_PORT = 45124; // different from proxy.test.ts's test port, to avoid any cross-suite collision

describe("DashboardServer.listen — port in use", () => {
  let blocker: net.Server | null = null;
  let server: DashboardServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
    if (blocker) {
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = null;
    }
  });

  it("rejects with a clear error when the port is already taken", async () => {
    blocker = net.createServer();
    await new Promise<void>((resolve) => blocker!.listen(TEST_PORT, "127.0.0.1", () => resolve()));

    const bus = new LoclynEventBus();
    server = new DashboardServer(bus);

    await expect(server.listen(TEST_PORT)).rejects.toThrow(`Port ${TEST_PORT} is already in use`);
  });

  it("still binds successfully on a genuinely free port", async () => {
    const bus = new LoclynEventBus();
    server = new DashboardServer(bus);

    await expect(server.listen(TEST_PORT)).resolves.toBeUndefined();
  });
});