import { LoclynEventBus } from "./event-bus.js";
import type {
  LoclynEvent,
  DiagnosticResult,
  DiagnosticSeverity,
  RequestLogEntry,
  WebSocketConnection,
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
  // Services that have had at least one ECONNREFUSED forward error — only
  // these are eligible to report ipv4-ipv6-mismatch at all, so the
  // diagnostic never appears as a false "ok" for a service that has never
  // actually had this failure.
  private hadForwardError = new Set<string>();
  // Services the registry currently reports as unreachable (from the TCP
  // probe). Used only to choose honest wording for the connection-refused
  // message — it never suppresses the diagnostic.
  private unreachableServices = new Set<string>();
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
    if (event.type === "websocket:updated") {
      this.evaluateWebsocket(event.payload);
    }
  }

  // ── Diagnostic 1: api-connectivity ────────────────────────────────────
  // Evidence: service:updated — directly reflects the registry's TCP probe.
  private evaluateServiceReachability(name: string, status: string, port: number): void {
    const severity: DiagnosticSeverity = status === "running" ? "ok" : "error";

    if (status === "unreachable") this.unreachableServices.add(name);
    else this.unreachableServices.delete(name);

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
    // WebSocket outcomes are judged from websocket:updated, not from the log.
    if (entry.type === "websocket") return;

    // A successful (non-502) response for this service means whatever
    // caused a past connection-refused warning is no longer happening —
    // clear it back to ok. Only applies to services that have actually
    // had a forward error before; otherwise this diagnostic simply
    // doesn't exist yet for that service, which is the correct state.
    if (entry.status < 500 && this.hadForwardError.has(entry.serviceName)) {
      this.emitIfChanged({
        id: "ipv4-ipv6-mismatch",
        label: "Connectivity",
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
  // Evidence: websocket:updated — the proxy observed the real handshake
  // result (accepted, refused, or unreachable). We know THAT it failed and
  // the immediate reason; we don't know whether the service itself is at
  // fault, so a failure is a warning, not an error.
  private evaluateWebsocket(conn: WebSocketConnection): void {
    if (conn.status === "connecting") return;
    const failed = conn.status === "failed";

    this.emitIfChanged({
      id: "websocket-hmr",
      label: "WebSocket (HMR)",
      detail: `${conn.serviceName} connection`,
      severity: failed ? "warning" : "ok",
      message: failed
        ? `WebSocket to "${conn.serviceName}" (${conn.path}) failed: ${conn.reason ?? "unknown reason"}.`
        : undefined,
      confidence: "high", // directly observed handshake result
      updatedAt: Date.now(),
      key: `websocket-hmr:${conn.serviceName}`,
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
      label: "Connectivity",
      // Must exactly match the detail string used in recordRequest's
      // clear-to-ok emission below — the dashboard keys each diagnostic
      // row by id+detail, so any mismatch here creates a second, separate
      // row instead of updating this one.
      detail: serviceName,
      severity: "warning",
      message: this.unreachableServices.has(serviceName)
        ? `"${serviceName}" is not responding on 127.0.0.1:${port}. It may simply not be running; if it is, it may be bound to a different network interface (e.g. IPv6-only) — verify it binds to 127.0.0.1.`
        : `Proxy connection to "${serviceName}" (:${port}) was actively refused. The service may have stopped, or may be bound to a different network interface (e.g. IPv6-only) than the address Loclyn connects on (127.0.0.1).`,
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