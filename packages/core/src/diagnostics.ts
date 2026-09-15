import { LoclynEventBus } from "./event-bus.js";
import type {
  LoclynEvent,
  DiagnosticResult,
  DiagnosticSeverity,
  RequestLogEntry,
} from "./types.js";

const HTTP_WINDOW_SIZE = 5; // how many recent requests per service we consider
const ERROR_STATUS_THRESHOLD = 500;

/**
 * DiagnosticsEngine is a pure subscriber — it never touches the proxy,
 * router, or registry directly. It only listens to events they already
 * emit and derives higher-level "is this actually healthy?" judgments
 * from patterns in that traffic. This is the same seam pattern used for
 * WebSockets: existing components don't change, a new listener just
 * reacts to what's already being broadcast.
 *
 * Each diagnostic here is intentionally traceable back to a real event —
 * see the comment above each check for exactly what evidence it's based on.
 */
export class DiagnosticsEngine {
  // Rolling window of recent HTTP statuses, per service name.
  private recentStatuses = new Map<string, number[]>();
  // Whether we've ever seen a successful websocket forward for a service.
  private websocketSeen = new Set<string>();
  // Services that have had at least one ECONNREFUSED forward error — only
  // these are eligible to report ipv4-ipv6-mismatch at all, so the
  // diagnostic never appears as a false "ok" for a service that has never
  // actually had this failure.
  private hadForwardError = new Set<string>();
  // Last emitted severity per diagnostic key, so we only emit on change
  // (same "don't spam the bus" pattern as ServiceRegistry.checkOne).
  private lastSeverity = new Map<string, DiagnosticSeverity>();

  constructor(private bus: LoclynEventBus) {
    this.bus.on((event) => this.handleEvent(event));
  }

  private handleEvent(event: LoclynEvent): void {
    if (event.type === "service:updated") {
      this.evaluateServiceReachability(event.payload.name, event.payload.status, event.payload.port);
    }
    if (event.type === "request:logged") {
      this.recordRequest(event.payload);
    }
    if (event.type === "proxy:forward-error") {
      this.evaluateForwardError(event.payload.serviceName, event.payload.port, event.payload.code);
    }
  }

  // ── Diagnostic 1: api-connectivity ────────────────────────────────────
  // Evidence: service:updated — directly reflects the registry's TCP probe.
  private evaluateServiceReachability(name: string, status: string, port: number): void {
    const severity: DiagnosticSeverity = status === "running" ? "ok" : "error";

    this.emitIfChanged({
      id: "api-connectivity",
      label: "API Connectivity",
      detail: `${name} (:${port})`,
      severity,
      message:
        severity === "error"
          ? `Service "${name}" on port ${port} is not responding to connection attempts.`
          : undefined,
      confidence: "high", // directly observed via TCP probe, not inferred
      updatedAt: Date.now(),
      key: `api-connectivity:${name}`,
    });
  }

  // ── Diagnostic 2: http-requests ────────────────────────────────────────
  // Evidence: request:logged — a rolling window of recent HTTP status codes
  // per service. One bad status is noise; several in a row is a pattern.
  private recordRequest(entry: RequestLogEntry): void {
    if (entry.type === "websocket") {
      this.websocketSeen.add(entry.serviceName);
      this.evaluateWebsocket(entry.serviceName);
      return; // websocket requests don't feed the HTTP status window
    }

    // A successful (non-502) response for this service means whatever
    // caused a past connection-refused warning is no longer happening —
    // clear it back to ok. Only applies to services that have actually
    // had a forward error before; otherwise this diagnostic simply
    // doesn't exist yet for that service, which is the correct state.
    if (entry.status < 500 && this.hadForwardError.has(entry.serviceName)) {
      this.emitIfChanged({
        id: "ipv4-ipv6-mismatch",
        label: "Connection Refused",
        detail: `${entry.serviceName}`,
        severity: "ok",
        confidence: "medium",
        updatedAt: Date.now(),
        key: `ipv4-ipv6-mismatch:${entry.serviceName}`,
      });
    }

    const window = this.recentStatuses.get(entry.serviceName) ?? [];
    window.push(entry.status);
    if (window.length > HTTP_WINDOW_SIZE) window.shift();
    this.recentStatuses.set(entry.serviceName, window);

    const errorCount = window.filter((s) => s >= ERROR_STATUS_THRESHOLD).length;
    const severity: DiagnosticSeverity =
      errorCount === 0 ? "ok" : errorCount === 1 ? "warning" : "error";

    this.emitIfChanged({
      id: "http-requests",
      label: "HTTP Requests",
      detail: `Proxy → ${entry.serviceName}`,
      severity,
      message:
        severity !== "ok"
          ? `${errorCount} of the last ${window.length} requests to "${entry.serviceName}" returned ${ERROR_STATUS_THRESHOLD}+.`
          : undefined,
      // "medium" confidence: a burst of 500s could be the target app's own
      // bug, not necessarily a Loclyn/proxy problem — we're inferring a
      // pattern, not directly observing a proxy-level failure.
      confidence: "medium",
      updatedAt: Date.now(),
      key: `http-requests:${entry.serviceName}`,
    });
  }

  // ── Diagnostic 3: websocket-hmr ─────────────────────────────────────────
  // Evidence: request:logged with type "websocket" — we know a WS upgrade
  // was forwarded. NOTE: we cannot yet detect a WS forward failing after
  // the fact — proxy.ts currently logs this event unconditionally, before
  // confirming the upgrade actually succeeded downstream. So this can only
  // ever report "ok" once seen, never flip back to an error on its own —
  // that's a known, honest limitation, not something faked here.
  private evaluateWebsocket(serviceName: string): void {
    this.emitIfChanged({
      id: "websocket-hmr",
      label: "WebSocket (HMR)",
      detail: `${serviceName} connection`,
      severity: "ok",
      confidence: "medium", // we see the forward attempt, not confirmed success
      updatedAt: Date.now(),
      key: `websocket-hmr:${serviceName}`,
    });
  }

  // ── Diagnostic 4: ipv4-ipv6-mismatch ────────────────────────────────────
  // Evidence: proxy:forward-error with code ECONNREFUSED — the proxy tried
  // to reach a service it believed was routable and was actively refused.
  // We CANNOT confirm this is actually an IPv4/IPv6 binding mismatch from
  // here — that would require knowing which interface the target process
  // bound to, which Loclyn has no visibility into. This is reported as a
  // plausible, common cause, at medium confidence, not a diagnosis.
  private evaluateForwardError(serviceName: string, port: number, code: string): void {
    if (code !== "ECONNREFUSED") return;

    this.hadForwardError.add(serviceName);
    this.emitIfChanged({
      id: "ipv4-ipv6-mismatch",
      label: "Connection Refused",
      detail: `${serviceName} (:${port})`,
      severity: "warning",
      message: `Proxy connection to "${serviceName}" was actively refused. A common cause is the service binding to a different network interface (e.g. IPv6-only) than the address Loclyn connects on (127.0.0.1). Verify the service explicitly binds to 127.0.0.1.`,
      confidence: "medium",
      updatedAt: Date.now(),
      key: `ipv4-ipv6-mismatch:${serviceName}`,
    });
  }

  // ── Shared emit helper ───────────────────────────────────────────────
  // Only broadcasts on the bus if this diagnostic's severity actually
  // changed since last time — same anti-spam pattern used elsewhere.
  private emitIfChanged(result: DiagnosticResult & { key: string }): void {
    const { key, ...payload } = result;
    if (this.lastSeverity.get(key) === payload.severity) return;
    this.lastSeverity.set(key, payload.severity);
    this.bus.emit({ type: "diagnostic:updated", payload });
  }
}