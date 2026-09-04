import { LoclynEventBus, ServiceRegistry, Router, LoclynProxy, DiagnosticsEngine } from "../src/index.js";

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

// Subscribes to the same bus as everything else — this is the only line
// needed to "turn on" diagnostics. It does not change registry, router,
// or proxy behavior in any way.
new DiagnosticsEngine(bus);

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
  console.log("[loclyn] proxy listening on :4020");
  console.log("[loclyn] try: curl http://localhost:4020/        (-> frontend)");
  console.log("[loclyn] try: curl http://localhost:4020/api/users (-> backend)");
}

main();