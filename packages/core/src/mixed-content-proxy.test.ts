import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { Router } from "./router.js";
import { LoclynProxy } from "./proxy.js";
import { DiagnosticsEngine } from "./diagnostics.js";
import type { DiagnosticResult } from "./types.js";

// Regression: through the real proxy + DiagnosticsEngine only (no extra wiring).
describe("mixed-content diagnostic through proxy + DiagnosticsEngine", () => {
  let backend: http.Server | null = null;
  let proxy: LoclynProxy | null = null;
  afterEach(async () => {
    await proxy?.close();
    proxy = null;
    if (backend) await new Promise<void>((r) => backend!.close(() => r()));
    backend = null;
  });

  const get = (port: number, host: string) =>
    new Promise<http.IncomingMessage>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/old?token=secret", headers: { Host: host, "X-Forwarded-Proto": "https" } },
        (res) => { res.resume(); resolve(res); }).on("error", reject);
    });

  it("warns on a localhost redirect via the tunnel host, then ok on a correct one", async () => {
    let location = "http://localhost:4000/new?token=secret";
    backend = http.createServer((_req, res) => { res.writeHead(302, { Location: location }); res.end(); });
    await new Promise<void>((r) => backend!.listen(45170, "127.0.0.1", () => r()));
    const bus = new LoclynEventBus();
    const registry = new ServiceRegistry([{ name: "api", type: "backend", port: 45170 }], bus);
    new DiagnosticsEngine(bus);
    proxy = new LoclynProxy(new Router(registry), bus);
    await proxy.listen(45171);

    const got: DiagnosticResult[] = [];
    bus.on((e) => e.type === "diagnostic:updated" && e.payload.id === "https-mixed-content" && got.push(e.payload));

    await get(45171, "abc-def.trycloudflare.com");
    await new Promise((r) => setTimeout(r, 100));
    expect(got.map((g) => g.severity)).toEqual(["warning"]);
    expect(got[0].message).toContain("localhost");
    expect(got[0].message).not.toContain("secret"); // query never captured

    location = "https://abc-def.trycloudflare.com/new";
    await get(45171, "abc-def.trycloudflare.com");
    await new Promise((r) => setTimeout(r, 100));
    expect(got.map((g) => g.severity)).toEqual(["warning", "ok"]);
  });
});