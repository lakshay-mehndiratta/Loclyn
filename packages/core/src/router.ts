import type { ServiceRegistry } from "./service-registry.js";
import type { ServiceState } from "./types.js";

/**
 * The Router answers exactly one question: "given this request path,
 * which local service should handle it?" It deliberately does NOT touch
 * sockets or send bytes anywhere — that separation means the routing
 * *decision* can be unit tested with zero real servers involved, which
 * matters a lot once diagnostics starts depending on routing being correct.
 */
export class Router {
  constructor(private registry: ServiceRegistry) {}

  resolve(path: string): ServiceState | undefined {
    return this.registry.findByPath(path);
  }
}