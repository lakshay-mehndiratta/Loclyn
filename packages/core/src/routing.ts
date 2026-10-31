import type { LoclynEventBus } from "./event-bus.js";
import type { DiagnosticResult, RouteMissing } from "./types.js";

/**
 * Turns "a request matched no configured route" into one Routing row.
 * This is directly observed (the router itself said no match), so
 * confidence is "high". It stays a warning until Loclyn restarts: a missing
 * route is an event, not a state we can later observe as fixed — the row's
 * "Last updated" time shows when it was last seen.
 */
export class RoutingAnalyzer {
  private lastMessage: string | null = null;

  constructor(private bus: LoclynEventBus) {
    bus.on((event) => {
      if (event.type === "route:missing") this.handle(event.payload);
    });
  }

  private handle(r: RouteMissing): void {
    const message = this.explain(r);
    if (message === this.lastMessage) return;
    this.lastMessage = message;
    const result: DiagnosticResult = {
      id: "no-route",
      label: "Routing",
      detail: "routing",
      severity: "warning",
      message,
      confidence: "high",
      updatedAt: Date.now(),
    };
    this.bus.emit({ type: "diagnostic:updated", payload: result });
  }

  private explain(r: RouteMissing): string {
    const configured =
      r.routes.length === 0
        ? "No services are configured."
        : `Configured: ${r.routes.map((x) => `${x.pathPrefix ?? "(everything else)"} → ${x.name}`).join(", ")}.`;
    return `No service handles ${r.method} ${r.path}. ${configured} Add a catch-all service (no pathPrefix) for everything else, or request a path that is configured.`;
  }
}