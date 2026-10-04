import http from "node:http";
import { RequestLogEntry } from "./types.js";
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { Router } from "./router.js";
import { LoclynProxy } from "./proxy.js";

const TEST_PORT = 45123; // an unlikely-to-collide, high, unregistered port

describe("LoclynProxy — response type classification", () => {
  let backend: http.Server | null = null;
  let proxy: LoclynProxy | null = null;

  afterEach(async () => {
    await proxy?.close();
    proxy = null;
    if (backend) {
      await new Promise<void>((resolve) => backend!.close(() => resolve()));
      backend = null;
    }
  });

  it("classifies an HTML response as document", async () => {
    const BACKEND_PORT = 45125;
    const PROXY_PORT = 45126;

    backend = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html></html>");
    });
    await new Promise<void>((resolve) => backend!.listen(BACKEND_PORT, "127.0.0.1", () => resolve()));

    const bus = new LoclynEventBus();
    const registry = new ServiceRegistry(
      [{ name: "frontend", type: "frontend", port: BACKEND_PORT }],
      bus,
    );
    const router = new Router(registry);
    proxy = new LoclynProxy(router, bus);

    const logged: Promise<RequestLogEntry> = new Promise((resolve) => {
      bus.on((event) => {
        if (event.type === "request:logged") resolve(event.payload);
      });
    });

    await proxy.listen(PROXY_PORT);
    await fetch(`http://127.0.0.1:${PROXY_PORT}/`);

    const entry = await logged;
    expect(entry.type).toBe("document");
  });
});

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