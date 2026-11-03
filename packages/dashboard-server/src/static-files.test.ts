import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { LoclynEventBus, type LoclynEvent } from "@loclyn/core";
import { DashboardServer } from "./dashboard-server.js";

describe("DashboardServer static dashboard", () => {
  let dir = "";
  let outside = "";
  let server: DashboardServer | null = null;
  const PORT = 45220;
  const url = (p: string) => `http://127.0.0.1:${PORT}${p}`;
  // Fresh connection per request: the server is restarted for every test on the
  // same port, and a pooled keep-alive socket from the previous test is dead.
  const fetch = (u: string, init: RequestInit = {}) =>
    globalThis.fetch(u, { ...init, headers: { connection: "close", ...(init.headers ?? {}) } });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "loclyn-ui-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "loclyn-secret-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<h1>home</h1>");
    fs.writeFileSync(path.join(dir, "diagnostics.html"), "<h1>diag</h1>");
    fs.mkdirSync(path.join(dir, "_next", "static"), { recursive: true });
    fs.writeFileSync(path.join(dir, "_next", "static", "app.js"), "console.log(1)");
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET");
    fs.symlinkSync(outside, path.join(dir, "escape"));
    server = new DashboardServer(new LoclynEventBus(), { staticDir: dir });
    await server.listen(PORT);
  });

  afterEach(async () => {
    await server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("serves the home page and maps /name to name.html", async () => {
    const home = await fetch(url("/"));
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toBe("<h1>home</h1>");
    expect(await (await fetch(url("/diagnostics"))).text()).toBe("<h1>diag</h1>");
  });

  it("serves hashed assets with the right type and long-lived caching, HTML uncached", async () => {
    const js = await fetch(url("/_next/static/app.js"));
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(url("/"))).headers.get("cache-control")).toBe("no-cache");
  });

  it("returns 404 for missing files and non-GET methods", async () => {
    expect((await fetch(url("/nope"))).status).toBe(404);
    expect((await fetch(url("/"), { method: "POST" })).status).toBe(404);
  });

  it("cannot be tricked into serving files outside the folder", async () => {
    // Raw request so the client does not normalise the ".." away.
    const status = await new Promise<number>((resolve) => {
      const net = require("node:net") as typeof import("node:net");
      const s = net.connect(PORT, "127.0.0.1", () => s.write("GET /../package.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
      let data = "";
      s.on("data", (c) => (data += c));
      s.on("close", () => resolve(Number(data.split(" ")[1])));
    });
    expect(status).toBe(404);
    expect((await fetch(url("/escape/secret.txt"))).status).toBe(404); // symlink out of the folder
    expect((await fetch(url("/%2e%2e/%2e%2e/etc/passwd"))).status).toBe(404);
  });

  it("still serves the /ws data socket on the same port", async () => {
    const received: LoclynEvent[] = [];
    const client = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    client.on("message", (d) => received.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => client.on("open", () => r()));
    client.close();
    expect(client.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
  });

  it("serves nothing (404) when no staticDir is given", async () => {
    await server!.close();
    server = new DashboardServer(new LoclynEventBus());
    await server.listen(PORT);
    expect((await fetch(url("/"))).status).toBe(404);
  });
});