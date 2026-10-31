import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { Router } from "./router.js";
import { LoclynProxy } from "./proxy.js";
import { DiagnosticsEngine } from "./diagnostics.js";
import { RoutingAnalyzer } from "./routing.js";
import { UNROUTED_SERVICE, type DiagnosticResult, type RequestLogEntry } from "./types.js";

describe("RoutingAnalyzer", () => {
  it("explains what is configured and does not repeat itself", () => {
    const bus = new LoclynEventBus();
    const got: DiagnosticResult[] = [];
    bus.on((e) => e.type === "diagnostic:updated" && got.push(e.payload));
    new RoutingAnalyzer(bus);
    const payload = { method: "GET", path: "/", time: 1, routes: [{ name: "cors-probe", pathPrefix: "/api" }] };
    bus.emit({ type: "route:missing", payload });
    bus.emit({ type: "route:missing", payload });
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe("no-route");
    expect(got[0].confidence).toBe("high");
    expect(got[0].message).toContain("/api → cors-probe");
    expect(got[0].message).toContain("GET /");
  });
});

describe("unrouted request through proxy + DiagnosticsEngine", () => {
  let backend: http.Server | null = null;
  let proxy: LoclynProxy | null = null;
  afterEach(async () => {
    await proxy?.close();
    proxy = null;
    if (backend) await new Promise<void>((r) => backend!.close(() => r()));
    backend = null;
  });

  it("logs the 502, raises one Routing warning, and leaves routed traffic alone", async () => {
    backend = http.createServer((_q, res) => res.end("ok"));
    await new Promise<void>((r) => backend!.listen(45180, "127.0.0.1", () => r()));
    const bus = new LoclynEventBus();
    const registry = new ServiceRegistry(
      [{ name: "cors-probe", type: "backend", port: 45180, pathPrefix: "/api" }],
      bus,
    );
    new DiagnosticsEngine(bus);
    proxy = new LoclynProxy(new Router(registry), bus);
    await proxy.listen(45181);

    const diags: DiagnosticResult[] = [];
    const logged: RequestLogEntry[] = [];
    bus.on((e) => {
      if (e.type === "diagnostic:updated") diags.push(e.payload);
      if (e.type === "request:logged") logged.push(e.payload);
    });

    const root = await fetch("http://127.0.0.1:45181/?x=1");
    expect(root.status).toBe(502);
    await fetch("http://127.0.0.1:45181/api/health");
    await new Promise((r) => setTimeout(r, 100));

    const unrouted = logged.find((l) => l.serviceName === UNROUTED_SERVICE);
    expect(unrouted?.status).toBe(502);
    expect(logged.some((l) => l.serviceName === "cors-probe" && l.status === 200)).toBe(true);
    const routing = diags.filter((d) => d.id === "no-route");
    expect(routing).toHaveLength(1);
    expect(routing[0].message).not.toContain("x=1"); // query never included
    // The placeholder must never produce an http-requests row of its own.
    expect(diags.some((d) => d.id === "http-requests" && d.detail.includes(UNROUTED_SERVICE))).toBe(false);
  });
});