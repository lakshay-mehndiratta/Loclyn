import net from "node:net";
import { LoclynEventBus } from "./event-bus.js";
import type { ServiceConfig, ServiceState, ServiceStatus } from "./types.js";

/**
 * The Service Registry is just a labeled list of "the local dev servers
 * Loclyn knows about" (e.g. Vite on 5173, Express on 3000), plus a simple
 * health check that periodically asks "is anything actually listening on
 * this port right now?"
 *
 * It does NOT do any request forwarding — that's the Router/Proxy's job.
 * The registry's only responsibilities: hold config, track status, and
 * announce status changes on the event bus.
 */
export class ServiceRegistry {
  private services = new Map<string, ServiceState>();

  constructor(
    configs: ServiceConfig[],
    private bus: LoclynEventBus,
  ) {
    for (const config of configs) {
      this.services.set(config.name, {
        ...config,
        status: "starting",
        lastCheckedAt: Date.now(),
      });
    }
  }

  list(): ServiceState[] {
    return [...this.services.values()];
  }

  get(name: string): ServiceState | undefined {
    return this.services.get(name);
  }

  /** Find the service whose pathPrefix matches a request path, falling back
   * to the one service with no pathPrefix (the "default" service). */
  findByPath(path: string): ServiceState | undefined {
    const withPrefix = this.list()
      .filter((s) => s.pathPrefix)
      // Longest prefix first, so "/api/admin" beats "/api" if both existed.
      .sort((a, b) => (b.pathPrefix?.length ?? 0) - (a.pathPrefix?.length ?? 0))
      .find((s) => path.startsWith(s.pathPrefix as string));

    return withPrefix ?? this.list().find((s) => !s.pathPrefix);
  }

  /** Checks each service's port with a raw TCP connect attempt — the
   * cheapest possible "is something there?" check, no HTTP involved. */
  async checkAll(): Promise<void> {
    await Promise.all(this.list().map((s) => this.checkOne(s.name)));
  }

  private async checkOne(name: string): Promise<void> {
    const service = this.services.get(name);
    if (!service) return;

    const reachable = await this.tcpProbe(service.port);
    const newStatus: ServiceStatus = reachable ? "running" : "unreachable";

    if (newStatus !== service.status) {
      const updated: ServiceState = {
        ...service,
        status: newStatus,
        lastCheckedAt: Date.now(),
      };
      this.services.set(name, updated);
      this.bus.emit({ type: "service:updated", payload: updated });
    }
  }

  private tcpProbe(port: number, host = "127.0.0.1", timeoutMs = 800): Promise<boolean> {
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
      socket.connect(port, host);
    });
  }
}