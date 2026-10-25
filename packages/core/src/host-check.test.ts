import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { HostCheckProbe } from "./host-check.js";
import type { DiagnosticResult } from "./types.js";

const servers: http.Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
});

function listen(port: number, handler: http.RequestListener): Promise<void> {
  return new Promise((r) => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(port, "127.0.0.1", r);
  });
}

async function run(port: number, framework: string) {
  const bus = new LoclynEventBus();
  const registry = new ServiceRegistry([{ name: "web", type: "frontend", framework, port }], bus);
  await registry.checkAll();
  const got: DiagnosticResult[] = [];
  bus.on((e) => {
    if (e.type === "diagnostic:updated" && e.payload.id === "dev-server-host-check") got.push(e.payload);
  });
  const probe = new HostCheckProbe(bus, registry, 60_000);
  bus.emit({
    type: "connection:updated",
    payload: { tunnel: "connected", proxy: "running", ssl: "active", deviceUrl: "https://abc-def.trycloudflare.com", startedAt: 1 },
  });
  await new Promise((r) => setTimeout(r, 400));
  probe.stop();
  return got;
}

describe("HostCheckProbe", () => {
  it("flags a Vite-like server that blocks foreign Host", async () => {
    await listen(45140, (req, res) => {
      res.statusCode = req.headers.host?.startsWith("localhost") ? 200 : 403;
      res.end("x");
    });
    const got = await run(45140, "Vite");
    expect(got.at(-1)?.severity).toBe("error");
    expect(got.at(-1)?.message).toContain("allowedHosts");
  });

  it("flags a Next-like server that blocks foreign Origin on /_next", async () => {
    await listen(45141, (req, res) => {
      res.statusCode = req.url?.startsWith("/_next") && req.headers.origin ? 403 : 200;
      res.end("x");
    });
    const got = await run(45141, "Next.js");
    expect(got.at(-1)?.severity).toBe("error");
    expect(got.at(-1)?.message).toContain("allowedDevOrigins");
  });

  it("reports ok for a healthy server", async () => {
    await listen(45142, (_req, res) => res.end("fine"));
    const got = await run(45142, "Vite");
    expect(got.at(-1)?.severity).toBe("ok");
  });
});