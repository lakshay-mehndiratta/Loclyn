import http from "node:http";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { Router } from "./router.js";
import { LoclynProxy } from "./proxy.js";
import { DiagnosticsEngine } from "./diagnostics.js";
import type { DiagnosticResult, SubresourceScan } from "./types.js";

// Integration: real backend + real proxy + DiagnosticsEngine (no extra wiring).
// "HTTPS page" is signalled the way Cloudflare does it: X-Forwarded-Proto: https.

const HTTPS = { "X-Forwarded-Proto": "https" };

interface Reply { status?: number; type: string; body: string | Buffer; headers?: Record<string, string> }

describe("mixed content inside proxied HTML/CSS", () => {
  let backend: http.Server | null = null;
  let proxy: LoclynProxy | null = null;
  let pages: Record<string, Reply> = {};

  afterEach(async () => {
    await proxy?.close();
    proxy = null;
    if (backend) await new Promise<void>((r) => backend!.close(() => r()));
    backend = null;
  });

  async function start(backendPort: number, proxyPort: number, handler?: http.RequestListener) {
    backend = http.createServer(
      handler ??
        ((req, res) => {
          const p = pages[(req.url ?? "/").split("?")[0]];
          if (!p) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("nope"); return; }
          res.writeHead(p.status ?? 200, { "Content-Type": p.type, ...(p.headers ?? {}) });
          res.end(p.body);
        }),
    );
    await new Promise<void>((r) => backend!.listen(backendPort, "127.0.0.1", () => r()));
    const bus = new LoclynEventBus();
    const registry = new ServiceRegistry([{ name: "web", type: "frontend", port: backendPort }], bus);
    new DiagnosticsEngine(bus);
    proxy = new LoclynProxy(new Router(registry), bus);
    await proxy.listen(proxyPort);
    const rows: DiagnosticResult[] = [];
    const scans: SubresourceScan[] = [];
    bus.on((e) => {
      if (e.type === "diagnostic:updated" && e.payload.id === "https-mixed-content") rows.push(e.payload);
      if (e.type === "subresources:scanned") scans.push(e.payload);
    });
    return { rows, scans, base: `http://127.0.0.1:${proxyPort}` };
  }

  const settle = () => new Promise((r) => setTimeout(r, 150));

  it("warns for an HTTPS page that loads an http script, naming the service and URL", async () => {
    pages = { "/": { type: "text/html; charset=utf-8", body: `<html><script src="http://cdn.example.com/app.js?k=SECRET"></script></html>` } };
    const { rows, base } = await start(45190, 45191);
    const res = await fetch(base + "/", { headers: HTTPS });
    await res.text();
    await settle();
    expect(rows.map((r) => r.severity)).toEqual(["warning"]);
    expect(rows[0].detail).toBe("web");
    expect(rows[0].message).toContain("script src http://cdn.example.com/app.js");
    expect(rows[0].message).not.toContain("SECRET");
  });

  it("is ok for an HTTPS page whose resources are all https / relative", async () => {
    pages = { "/": { type: "text/html", body: `<script src="https://cdn.example.com/a.js"></script><img src="/logo.png"><link rel="stylesheet" href="//cdn.example.com/s.css">` } };
    const { rows, base } = await start(45192, 45193);
    await (await fetch(base + "/", { headers: HTTPS })).text();
    await settle();
    expect(rows.map((r) => r.severity)).toEqual(["ok"]);
  });

  it("does not flag ordinary http navigation links", async () => {
    pages = { "/": { type: "text/html", body: `<a href="http://example.com/about">About</a><form action="http://example.com/post"></form><link rel="canonical" href="http://example.com/">` } };
    const { rows, scans, base } = await start(45194, 45195);
    await (await fetch(base + "/", { headers: HTTPS })).text();
    await settle();
    expect(scans[0].insecure).toEqual([]);
    expect(rows.map((r) => r.severity)).toEqual(["ok"]);
  });

  it("ignores non-HTML responses even if their text contains http:// resource markup", async () => {
    pages = { "/api": { type: "application/json", body: `{"html":"<img src=\\"http://a.com/x.png\\">"}` } };
    const { rows, scans, base } = await start(45196, 45197);
    await (await fetch(base + "/api", { headers: HTTPS })).text();
    await settle();
    expect(scans).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it("does nothing when the page was NOT loaded over https (no header, or explicit http)", async () => {
    pages = { "/": { type: "text/html", body: `<script src="http://cdn.example.com/app.js"></script>` } };
    const { rows, scans, base } = await start(45198, 45199);
    await (await fetch(base + "/")).text(); // direct local use, no scheme signal
    await (await fetch(base + "/", { headers: { "X-Forwarded-Proto": "http" } })).text();
    await settle();
    expect(scans).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it("flags url(http://…) in a CSS file served to an HTTPS page", async () => {
    pages = { "/app.css": { type: "text/css", body: `.hero{background:url(http://cdn.example.com/hero.jpg)}` } };
    const { rows, base } = await start(45200, 45201);
    await (await fetch(base + "/app.css", { headers: HTTPS })).text();
    await settle();
    expect(rows[0].severity).toBe("warning");
    expect(rows[0].message).toContain("css url() http://cdn.example.com/hero.jpg");
  });

  it("scans gzip and brotli responses, and the browser still gets the identical compressed bytes", async () => {
    const html = `<img src="http://cdn.example.com/p.png">`;
    for (const [enc, body, ports] of [
      ["gzip", zlib.gzipSync(html), [45202, 45203]],
      ["br", zlib.brotliCompressSync(html), [45204, 45205]],
    ] as const) {
      pages = { "/": { type: "text/html", body, headers: { "Content-Encoding": enc } } };
      const { rows, base } = await start(ports[0], ports[1]);
      const got = await new Promise<Buffer>((resolve) =>
        http.get(base + "/", { headers: HTTPS }, (res) => {
          const parts: Buffer[] = [];
          res.on("data", (c) => parts.push(c));
          res.on("end", () => resolve(Buffer.concat(parts)));
        }),
      );
      await settle();
      expect(got.equals(body)).toBe(true); // byte-for-byte unchanged
      expect(rows[0].severity).toBe("warning");
      await proxy!.close(); proxy = null;
      await new Promise<void>((r) => backend!.close(() => r())); backend = null;
    }
  });

  it("keeps streaming: the first chunk reaches the browser before the backend finishes", async () => {
    let releaseSecond: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseSecond = r));
    const { rows, base } = await start(45206, 45207, (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write(`<html><img src="http://cdn.example.com/a.png">`);
      void gate.then(() => res.end(`</html>`));
    });
    const firstChunk = await new Promise<string>((resolve) => {
      http.get(base + "/", { headers: HTTPS }, (res) => {
        res.once("data", (c) => { resolve(String(c)); });
        res.on("end", () => {});
      });
    });
    expect(firstChunk).toContain("<img"); // arrived while the backend is still holding the response open
    releaseSecond();
    await settle();
    expect(rows[0].severity).toBe("warning");
  });

  it("goes back to ok once the page no longer references http resources", async () => {
    pages = { "/": { type: "text/html", body: `<script src="http://cdn.example.com/app.js"></script>` } };
    const { rows, base } = await start(45208, 45209);
    await (await fetch(base + "/", { headers: HTTPS })).text();
    pages["/"] = { type: "text/html", body: `<script src="https://cdn.example.com/app.js"></script>` };
    await (await fetch(base + "/", { headers: HTTPS })).text();
    await settle();
    expect(rows.map((r) => r.severity)).toEqual(["warning", "ok"]);
  });
});