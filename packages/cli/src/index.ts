#!/usr/bin/env node
import net from "node:net";
import readline from "node:readline/promises";
import { Command } from "commander";
import {
  LoclynEventBus,
  ServiceRegistry,
  Router,
  LoclynProxy,
  DiagnosticsEngine,
  LogCollector,
  TunnelManager,
  detectProject,
  loadConfigFile,
  ConfigError,
  CONFIG_FILE_NAME,
  DEFAULT_PROXY_PORT,
  DEFAULT_DASHBOARD_PORT,
  type LoclynConfig,
  type ServiceConfig,
} from "@loclyn/core";
import { DashboardServer } from "@loclyn/dashboard-server";

const program = new Command();

program
  .name("loclyn")
  .description("Bridge local dev services behind one proxy")
  .option(
    "--frontend <port>",
    "frontend dev server port (or your only port, for a single full-stack app). Omit to use .loclyn.json or auto-detect.",
    parsePort,
  )
  .option("--backend <port>", "backend dev server port, if separate from the frontend", parsePort)
  .option("--proxy-port <port>", `port for Loclyn's proxy (default ${DEFAULT_PROXY_PORT})`, parsePort)
  .option(
    "--dashboard-port <port>",
    `port for Loclyn's dashboard data server (default ${DEFAULT_DASHBOARD_PORT})`,
    parsePort,
  )
  .option("-y, --yes", "skip the confirmation prompt when auto-detecting")
  .parse(process.argv);

const options = program.opts<{
  frontend?: number;
  backend?: number;
  proxyPort?: number;
  dashboardPort?: number;
  yes?: boolean;
}>();

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid port: "${value}"`);
    process.exit(1);
  }
  return port;
}

/** Cheap "is anything listening here?" check, used only before startup so
 * we can warn about a wrong port. (The registry does its own probing once
 * Loclyn is running.) */
function isPortOpen(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

/** Loads .loclyn.json from the current folder. Returns null if there is
 * none; prints every problem and exits if the file is invalid. */
function loadConfigOrExit(): LoclynConfig | null {
  try {
    return loadConfigFile(process.cwd());
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

/** Decides which services Loclyn should bridge. Precedence:
 * 1. explicit flags, 2. .loclyn.json, 3. auto-detection. */
async function resolveServices(fileConfig: LoclynConfig | null): Promise<ServiceConfig[]> {
  // ── 1. Explicit mode: flags are the source of truth ───────────────────
  if (options.frontend !== undefined) {
    if (fileConfig) {
      console.log(`Using --frontend flags; ignoring the services listed in ${CONFIG_FILE_NAME}.`);
    }
    const services: ServiceConfig[] = [{ name: "frontend", type: "frontend", port: options.frontend }];
    if (options.backend !== undefined) {
      services.push({ name: "backend", type: "backend", port: options.backend, pathPrefix: "/api" });
    }
    return services;
  }

  // ── 2. Config file mode ───────────────────────────────────────────────
  if (fileConfig) {
    if (options.backend !== undefined) {
      console.log(`⚠ --backend is ignored when services come from ${CONFIG_FILE_NAME}.`);
    }
    console.log(`Using ${CONFIG_FILE_NAME} in ${process.cwd()}`);
    console.log("");
    console.log("Services:");
    for (const s of fileConfig.services) {
      const route = s.pathPrefix ?? "(catch-all)";
      console.log(`  ${s.name.padEnd(12)} ${(s.framework ?? "—").padEnd(14)} :${s.port}  ${route}`);
    }
    console.log("");

    const reachable = await Promise.all(fileConfig.services.map((s) => isPortOpen(s.port)));
    fileConfig.services.forEach((s, i) => {
      if (!reachable[i]) console.log(`⚠ Nothing is listening on :${s.port} (${s.name}).`);
    });
    return fileConfig.services;
  }

  // ── 3. Detection mode ─────────────────────────────────────────────────
  console.log(`No --frontend or ${CONFIG_FILE_NAME} — detecting your stack in ${process.cwd()}`);
  const { services: detected, notes } = await detectProject(process.cwd());
  const frontends = detected.filter((s) => s.role === "frontend");
  const backends = detected.filter((s) => s.role === "backend");

  // Zero or ambiguous matches: don't guess, explain and stop.
  if (frontends.length !== 1 || (backends.length > 1 && options.backend === undefined)) {
    if (frontends.length === 0) {
      console.error("✗ Couldn't detect a frontend framework (looked for Next.js, Vite, Create React App) here.");
    }
    for (const note of notes) console.error(`✗ ${note}`);
    console.error(
      `  Run Loclyn from your project folder, create a ${CONFIG_FILE_NAME}, or pass --frontend <port> explicitly.`,
    );
    process.exit(1);
  }

  const frontend = frontends[0];
  const frontendPort = frontend.port;
  if (frontendPort === null) {
    console.error("✗ Detected a frontend framework but couldn't determine its port. Pass --frontend <port>.");
    process.exit(1);
  }

  const entries: Array<{ config: ServiceConfig; note: string }> = [
    {
      config: { name: "frontend", type: "frontend", framework: frontend.framework, port: frontendPort },
      note: frontend.portSource === "script-flag" ? "port from dev script" : "assumed framework default",
    },
  ];

  const detectedBackend = backends.length === 1 ? backends[0] : undefined;
  const backendPort = options.backend ?? detectedBackend?.port ?? null;

  if (backendPort !== null) {
    entries.push({
      config: {
        name: "backend",
        type: "backend",
        framework: detectedBackend?.framework,
        port: backendPort,
        pathPrefix: "/api",
      },
      note: options.backend !== undefined ? "port from --backend" : "port from dev script",
    });
  } else if (detectedBackend) {
    console.log(
      `⚠ ${detectedBackend.framework} backend detected, but its port can't be found in package.json. ` +
        `Pass --backend <port> to route /api to it. Continuing without it.`,
    );
  }

  console.log("");
  console.log("Detected:");
  for (const { config, note } of entries) {
    console.log(`  ${config.name.padEnd(9)} ${(config.framework ?? "—").padEnd(18)} :${config.port}  (${note})`);
  }
  console.log("");

  // Verify the detected ports are actually live before starting anything.
  const reachable = await Promise.all(entries.map((e) => isPortOpen(e.config.port)));
  entries.forEach(({ config }, i) => {
    if (!reachable[i]) console.log(`⚠ Nothing is listening on :${config.port} (${config.name}).`);
  });
  if (!reachable[0]) {
    console.error(
      "✗ Your frontend isn't running on the detected port. Start your dev server first (e.g. npm run dev), " +
        "or pass --frontend <port> if it uses a different port.",
    );
    process.exit(1);
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error("✗ Not an interactive terminal — pass --yes to start without confirmation.");
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("SIGINT", () => {
      rl.close();
      console.log("\nCancelled.");
      process.exit(0);
    });
    const answer = (await rl.question("Start Loclyn with these services? (Y/n) ")).trim().toLowerCase();
    rl.close();
    if (answer !== "" && answer !== "y" && answer !== "yes") {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  return entries.map((e) => e.config);
}

/** Final safety check after merging flags + file + defaults: Loclyn's own
 * ports must differ from each other and from every service port. */
function exitOnPortConflicts(
  services: ServiceConfig[],
  proxyPort: number,
  dashboardPort: number,
): void {
  const problems: string[] = [];
  if (proxyPort === dashboardPort) {
    problems.push(`proxy and dashboard are both set to port ${proxyPort}`);
  }
  for (const s of services) {
    if (s.port === proxyPort || s.port === dashboardPort) {
      problems.push(`service "${s.name}" uses port ${s.port}, which Loclyn needs for itself`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error("  Change the port in your flags or in " + CONFIG_FILE_NAME + ".");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const fileConfig = loadConfigOrExit();

  // flags > config file > defaults
  const proxyPort = options.proxyPort ?? fileConfig?.proxyPort ?? DEFAULT_PROXY_PORT;
  const dashboardPort = options.dashboardPort ?? fileConfig?.dashboardPort ?? DEFAULT_DASHBOARD_PORT;

  const services = await resolveServices(fileConfig);
  exitOnPortConflicts(services, proxyPort, dashboardPort);

  const bus = new LoclynEventBus();
  const registry = new ServiceRegistry(services, bus);
  const router = new Router(registry);
  const proxy = new LoclynProxy(router, bus);
  new DiagnosticsEngine(bus);
  new LogCollector(bus);

  const dashboard = new DashboardServer(bus);
  try {
    await dashboard.listen(dashboardPort);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("");
    console.log(`✗ Port In Use: ${message}`);
    console.log(
      `  Loclyn's dashboard server needs port ${dashboardPort} — stop whatever else is using it, or check for a Loclyn instance already running.`,
    );
    process.exit(1);
  }

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

  try {
    await proxy.listen(proxyPort);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("");
    console.log(`✗ Port In Use: ${message}`);
    console.log(
      `  Loclyn's proxy needs port ${proxyPort} — stop whatever else is using it, or check for a Loclyn instance already running.`,
    );
    await dashboard.close();
    process.exit(1);
  }

  tunnel.reportProxyRunning();
  registry.startPolling(3000);

  console.log("");
  console.log(`Proxy running at http://localhost:${proxyPort}`);
  console.log(`Dashboard data server running at ws://localhost:${dashboardPort}`);
  console.log("Dashboard UI: start it separately, then open http://localhost:3001");
  if (dashboardPort !== DEFAULT_DASHBOARD_PORT) {
    console.log(
      `  (custom dashboard port: start the UI with NEXT_PUBLIC_LOCLYN_WS_URL=ws://localhost:${dashboardPort}/ws)`,
    );
  }
  console.log("Starting tunnel...");

  tunnel.start(proxyPort);

  console.log("");
  console.log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\nStopping Loclyn...");

    const forceExit = setTimeout(() => {
      console.log("Shutdown taking too long — forcing exit.");
      process.exit(1);
    }, 5000);
    forceExit.unref();

    registry.stopPolling();
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