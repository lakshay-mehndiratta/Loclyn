#!/usr/bin/env node
import { Command } from "commander";
import {
  LoclynEventBus,
  ServiceRegistry,
  Router,
  LoclynProxy,
  DiagnosticsEngine,
  TunnelManager,
  type ServiceConfig,
} from "@loclyn/core";
import { DashboardServer } from "@loclyn/dashboard-server";

const PROXY_PORT = 4020;
const DASHBOARD_PORT = 4021;

const program = new Command();

program
  .name("loclyn")
  .description("Bridge local dev services behind one proxy")
  .requiredOption("--frontend <port>", "frontend dev server port (or your only port, for a single full-stack app)", parsePort)
  .option("--backend <port>", "backend dev server port, if separate from the frontend", parsePort)
  .parse(process.argv);

const options = program.opts<{ frontend: number; backend?: number }>();

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid port: "${value}"`);
    process.exit(1);
  }
  return port;
}

async function main(): Promise<void> {
  const services: ServiceConfig[] = [
    { name: "frontend", type: "frontend", port: options.frontend },
  ];

  // Only register a separate backend service, with the /api prefix, when
  // one was actually given. A single full-stack app (e.g. Next.js, where
  // API routes live on the same port as everything else) has nothing to
  // split — registering a fake second service would misrepresent the
  // real setup rather than reflect it.
  if (options.backend) {
    services.push({ name: "backend", type: "backend", port: options.backend, pathPrefix: "/api" });
  }

  const bus = new LoclynEventBus();
  const registry = new ServiceRegistry(services, bus);
  const router = new Router(registry);
  const proxy = new LoclynProxy(router, bus);
  new DiagnosticsEngine(bus);

  const dashboard = new DashboardServer(bus);
  await dashboard.listen(DASHBOARD_PORT);

  const tunnel = new TunnelManager(bus);

  bus.on((event) => {
    if (event.type === "service:updated") {
      const s = event.payload;
      const icon = s.status === "running" ? "✓" : "✗";
      console.log(`${icon} ${s.name} (:${s.port}) ${s.status}`);
    }
    if (event.type === "diagnostic:updated") {
      const d = event.payload;
      if (d.severity === "ok") return;
      const icon = d.severity === "warning" ? "⚠" : "✗";
      console.log(`${icon} ${d.label}: ${d.message ?? d.severity}`);
    }
    if (event.type === "connection:updated") {
      const c = event.payload;
      if (c.tunnel === "connected" && c.deviceUrl) {
        console.log("");
        console.log(`Device URL: ${c.deviceUrl}`);
      }
      if (c.tunnel === "disconnected") {
        console.log("⚠ Tunnel disconnected");
      }
    }
  });

  console.log("Loclyn");
  console.log("─".repeat(32));
  console.log("");

  await registry.checkAll();
  await proxy.listen(PROXY_PORT);
  tunnel.reportProxyRunning();

  console.log("");
  console.log(`Proxy running at http://localhost:${PROXY_PORT}`);
  console.log(`Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  console.log("Starting tunnel...");

  tunnel.start(PROXY_PORT);

  console.log("");
  console.log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\nStopping Loclyn...");

    const forceExit = setTimeout(() => {
      console.log("Shutdown taking too long — forcing exit.");
      process.exit(1);
    }, 5000);
    forceExit.unref();

    tunnel.stop();
    await proxy.close();
    await dashboard.close();

    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();