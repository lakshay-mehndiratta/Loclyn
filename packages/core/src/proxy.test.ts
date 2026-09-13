import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { Router } from "./router.js";
import { LoclynProxy } from "./proxy.js";

const TEST_PORT = 45123; // an unlikely-to-collide, high, unregistered port

describe("LoclynProxy.listen — port in use", () => {
  let blocker: net.Server | null = null;
  let proxy: LoclynProxy | null = null;

  afterEach(async () => {
    // Always clean up both the blocking socket and any successfully-bound
    // proxy, so one test's leftover state can never affect the next.
    await proxy?.close();
    proxy = null;
    if (blocker) {
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = null;
    }
  });

  it("rejects with a clear error when the port is already taken", async () => {
    // Occupy the port first, exactly like a stuck previous Loclyn
    // instance (or anything else) would.
    blocker = net.createServer();
    await new Promise<void>((resolve) => blocker!.listen(TEST_PORT, "127.0.0.1", () => resolve()));

    const bus = new LoclynEventBus();
    const registry = new ServiceRegistry([], bus);
    const router = new Router(registry);
    proxy = new LoclynProxy(router, bus);

    await expect(proxy.listen(TEST_PORT)).rejects.toThrow(`Port ${TEST_PORT} is already in use`);
  });

  it("still binds successfully on a genuinely free port", async () => {
    const bus = new LoclynEventBus();
    const registry = new ServiceRegistry([], bus);
    const router = new Router(registry);
    proxy = new LoclynProxy(router, bus);

    await expect(proxy.listen(TEST_PORT)).resolves.toBeUndefined();
  });
});