import { LoclynEventBus, ServiceRegistry, Router, LoclynProxy, DiagnosticsEngine } from "@loclyn/core";
import { DashboardServer } from "@loclyn/dashboard-server";

const DASHBOARD_PORT = 4021;

const bus = new LoclynEventBus();

const registry = new ServiceRegistry(
  [
    { name: "frontend", type: "frontend", framework: "Vite (fake)", port: 5173 },
    { name: "backend", type: "backend", framework: "Express (fake)", port: 3000, pathPrefix: "/api" },
  ],
  bus,
);

const router = new Router(registry);
const proxy = new LoclynProxy(router, bus);
new DiagnosticsEngine(bus);

// Added so the Next.js dashboard (localhost:3001) can connect to this demo
// harness for manual UI verification — mirrors exactly what the real CLI
// already wires up in cli/src/index.ts. Not a new architectural piece;
// run-demo.ts was just never updated to match after dashboard-server was
// split into its own package.
const dashboard = new DashboardServer(bus);

bus.on((event) => {
  if (event.type === "request:logged") {
    const r = event.payload;
    console.log(`[loclyn] ${r.method} ${r.path} -> ${r.status} (${r.serviceName}, ${r.durationMs}ms)`);
  }
  if (event.type === "service:updated") {
    const s = event.payload;
    console.log(`[loclyn] service "${s.name}" is now ${s.status}`);
  }
  if (event.type === "diagnostic:updated") {
    const d = event.payload;
    const icon = d.severity === "ok" ? "✓" : d.severity === "warning" ? "⚠" : "✗";
    console.log(`[diagnostics] ${icon} ${d.label} (${d.detail}): ${d.severity}${d.message ? " — " + d.message : ""}`);
  }
});

async function main() {
  await registry.checkAll();
  await proxy.listen(4020);
  await dashboard.listen(DASHBOARD_PORT);
  console.log("[loclyn] proxy listening on :4020");
  console.log(`[loclyn] dashboard-server listening on :${DASHBOARD_PORT}`);
  console.log("[loclyn] try: curl http://localhost:4020/        (-> frontend)");
  console.log("[loclyn] try: curl http://localhost:4020/api/users (-> backend)");
}

main();