#!/usr/bin/env node
import { Command } from "commander";
import {
  LoclynEventBus,
  ServiceRegistry,
  Router,
  LoclynProxy,
  DiagnosticsEngine,
  type ServiceConfig,
} from "@loclyn/core";
import { DashboardServer } from "@loclyn/dashboard";

const PROXY_PORT = 4020;
const DASHBOARD_PORT = 4021;

const program = new Command();

program
  .name("loclyn")
  .description("Bridge local dev services behind one proxy")
  .requiredOption("--frontend <port>", "frontend dev server port", parsePort)
  .requiredOption("--backend <port>", "backend dev server port", parsePort)
  .parse(process.argv);

const options = program.opts<{ frontend: number; backend: number }>();

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
    { name: "backend", type: "backend", port: options.backend, pathPrefix: "/api" },
  ];

  const bus = new LoclynEventBus();
  const registry = new ServiceRegistry(services, bus);
  const router = new Router(registry);
  const proxy = new LoclynProxy(router, bus);
  new DiagnosticsEngine(bus);

  const dashboard = new DashboardServer(bus);
  await dashboard.listen(DASHBOARD_PORT);

  bus.on((event) => {
    if (event.type === "service:updated") {
      const s = event.payload;
      const icon = s.status === "running" ? "✓" : "✗";
      console.log(`${icon} ${s.name} (:${s.port}) ${s.status}`);
    }
    if (event.type === "diagnostic:updated") {
      const d = event.payload;
      if (d.severity === "ok") return; // startup checklist only shows problems, not routine OKs
      const icon = d.severity === "warning" ? "⚠" : "✗";
      console.log(`${icon} ${d.label}: ${d.message ?? d.severity}`);
    }
  });

  console.log("Loclyn");
  console.log("─".repeat(32));
  console.log("");

  await registry.checkAll();
  await proxy.listen(PROXY_PORT);

  console.log("");
  console.log(`Proxy running at http://localhost:${PROXY_PORT}`);
  console.log(`Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  console.log("");
  console.log("Press Ctrl+C to stop.");

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;

    shuttingDown = true;

    console.log("\nStopping Loclyn...");

    await proxy.close();
    await dashboard.close();

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();