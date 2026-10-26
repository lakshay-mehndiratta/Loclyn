import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { Router } from "./router.js";
import { LoclynProxy } from "./proxy.js";
import type { CorsObservation } from "./types.js";

describe("LoclynProxy — CORS observations", () => {
  let backend: http.Server | null = null;
  let proxy: LoclynProxy | null = null;

  afterEach(async () => {
    await proxy?.close();
    proxy = null;
    if (backend) await new Promise<void>((r) => backend!.close(() => r()));
    backend = null;
  });

  async function start(backendPort: number, proxyPort: number) {
    backend = http.createServer((_req, res) => {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Set-Cookie": "secret=1" });
      res.end("ok");
    });
    await new Promise<void>((r) => backend!.listen(backendPort, "127.0.0.1", () => r()));
    const bus = new LoclynEventBus();
    const registry = new ServiceRegistry([{ name: "api", type: "backend", port: backendPort }], bus);
    proxy = new LoclynProxy(new Router(registry), bus);
    await proxy.listen(proxyPort);
    return bus;
  }

  it("emits cors:observed with allowlisted fields only when Origin is present", async () => {
    const bus = await start(45150, 45151);
    const seen: CorsObservation[] = [];
    bus.on((e) => e.type === "cors:observed" && seen.push(e.payload));

    await fetch("http://127.0.0.1:45151/api/x?token=abc", { headers: { Origin: "http://localhost:3000" } });
    await fetch("http://127.0.0.1:45151/plain"); // no Origin → nothing
    await new Promise((r) => setTimeout(r, 100));

    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe("/api/x"); // query stripped
    expect(seen[0].origin).toBe("http://localhost:3000");
    expect(seen[0].allowOrigin).toBe("*");
    expect(JSON.stringify(seen[0])).not.toContain("secret");
  });
});