import { describe, it, expect } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { ServiceRegistry } from "./service-registry.js";
import { Router } from "./router.js";
import type { ServiceConfig } from "./types.js";

function buildRouter(configs: ServiceConfig[]): Router {
  // A fresh, unused event bus is enough here — checkAll() is never called
  // in these tests, so no service:updated events actually fire. We only
  // care about Router.resolve(), which is pure "path in, service out"
  // logic with no networking involved.
  const bus = new LoclynEventBus();
  const registry = new ServiceRegistry(configs, bus);
  return new Router(registry);
}

describe("Router.resolve", () => {
  it("routes a prefixed path to the matching service", () => {
    const router = buildRouter([
      { name: "frontend", type: "frontend", port: 5173 },
      { name: "backend", type: "backend", port: 3000, pathPrefix: "/api" },
    ]);

    const result = router.resolve("/api/users");

    expect(result?.name).toBe("backend");
  });

  it("falls back to the catch-all service when no prefix matches", () => {
    const router = buildRouter([
      { name: "frontend", type: "frontend", port: 5173 },
      { name: "backend", type: "backend", port: 3000, pathPrefix: "/api" },
    ]);

    const result = router.resolve("/dashboard/settings");

    expect(result?.name).toBe("frontend");
  });

  it("prefers the longest matching prefix when more than one could match", () => {
    const router = buildRouter([
      { name: "frontend", type: "frontend", port: 5173 },
      { name: "api", type: "backend", port: 3000, pathPrefix: "/api" },
      { name: "admin-api", type: "backend", port: 3001, pathPrefix: "/api/admin" },
    ]);

    const result = router.resolve("/api/admin/users");

    expect(result?.name).toBe("admin-api");
  });

  it("still routes a non-admin /api path to the shorter-prefix service", () => {
    const router = buildRouter([
      { name: "frontend", type: "frontend", port: 5173 },
      { name: "api", type: "backend", port: 3000, pathPrefix: "/api" },
      { name: "admin-api", type: "backend", port: 3001, pathPrefix: "/api/admin" },
    ]);

    const result = router.resolve("/api/users");

    expect(result?.name).toBe("api");
  });

  it("returns undefined when nothing matches and there is no catch-all service", () => {
    const router = buildRouter([
      { name: "api", type: "backend", port: 3000, pathPrefix: "/api" },
    ]);

    const result = router.resolve("/anything-else");

    expect(result).toBeUndefined();
  });

  it("treats the root path as matching the catch-all service", () => {
    const router = buildRouter([
      { name: "frontend", type: "frontend", port: 5173 },
      { name: "backend", type: "backend", port: 3000, pathPrefix: "/api" },
    ]);

    const result = router.resolve("/");

    expect(result?.name).toBe("frontend");
  });
});