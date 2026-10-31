// ── Services (maps to "Services" panel in the dashboard) ──────────────────

export type ServiceType = "frontend" | "backend";

export interface ServiceConfig {
  name: string;
  type: ServiceType;
  framework?: string; // e.g. "Vite", "Express" — shown as the badge in the UI
  port: number;
  pathPrefix?: string; // e.g. "/api" — undefined means "default/catch-all"
}

export type ServiceStatus = "starting" | "running" | "unreachable" | "stopped";

export interface ServiceState extends ServiceConfig {
  status: ServiceStatus;
  lastCheckedAt: number;
}

// ── Connection (maps to "Connection" panel: Tunnel / Proxy / SSL / Uptime) ─

export interface ConnectionState {
  tunnel: "connecting" | "connected" | "disconnected";
  proxy: "starting" | "running" | "stopped";
  ssl: "active" | "inactive";
  deviceUrl: string | null;
  startedAt: number | null;
}

// ── Diagnostics (maps to "Diagnostics" panel) ──────────────────────────────

export type DiagnosticId =
  | "http-requests"
  | "api-connectivity"
  | "websocket-hmr"
  | "cors"
  | "https-mixed-content"
  | "port-in-use"
  | "tunnel-availability"
  | "ipv4-ipv6-mismatch"
  | "dev-server-host-check"
  | "no-route";

export type DiagnosticSeverity = "ok" | "warning" | "error";

export interface DiagnosticResult {
  id: DiagnosticId;
  label: string; // "HTTP Requests", "CORS", etc.
  detail: string; // "Frontend → Proxy", "Cross-Origin Requests"
  severity: DiagnosticSeverity;
  message?: string; // populated when severity !== "ok" — the explanation
  confidence: "high" | "medium"; // are we observing directly or inferring?
  updatedAt: number;
}

// ── Requests (maps to "Recent Requests" table) ─────────────────────────────

export type RequestKind = "document" | "fetch" | "websocket" | "asset";

export interface RequestLogEntry {
  id: string;
  time: number;
  method: string; // "GET", "POST", "WS"
  path: string;
  status: number; // HTTP status, or 101 for WS upgrade
  serviceName: string;
  type: RequestKind;
  sizeBytes: number | null; // null for websockets (streamed, no fixed size)
  durationMs: number | null; // null while a websocket is still open
}

// ── Event bus contract ──────────────────────────────────────────────────
// Core emits these; CLI and dashboard both subscribe and render independently.

export interface ProxyForwardError {
  serviceName: string;
  port: number;
  code: string; // e.g. "ECONNREFUSED" — Node's raw error code, when available
  time: number;
}

export type WebSocketStatus = "connecting" | "open" | "closed" | "failed";

export interface WebSocketConnection {
  id: string;
  serviceName: string;
  path: string;
  status: WebSocketStatus;
  startedAt: number;
  openedAt: number | null;
  closedAt: number | null;
  reason?: string; // why it failed, when status is "failed"
}

export type LogLevel = "info" | "warn" | "error";
export type LogSource = "service" | "proxy" | "tunnel" | "diagnostics" | "websocket";

export interface LogEntry {
  id: string;
  time: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}

export type ValueSource = "flag" | "config-file" | "default";
export type ServicesSource = "flags" | "config-file" | "detection";

export interface LoclynSettings {
  proxyPort: number;
  proxyPortSource: ValueSource;
  dashboardPort: number;
  dashboardPortSource: ValueSource;
  servicesSource: ServicesSource;
  configFile: string | null; // absolute path of .loclyn.json, if one was found
  workingDirectory: string;
  startedAt: number;
  nodeVersion: string;
  platform: string;
}

export interface CorsObservation {
  serviceName: string;
  method: string;
  path: string; // query string removed
  status: number;
  origin: string; // request "Origin" header
  host: string; // request "Host" header
  isPreflight: boolean; // OPTIONS + Access-Control-Request-Method
  allowOrigin: string | null; // response "Access-Control-Allow-Origin"
  time: number;
}

// ── Redirect observation ───────────────────────────────────────────────
// Captured from response "Location" headers (redirects / created resources).
// Only the target's scheme+host and path are kept — the query string and
// fragment are dropped because they can hold tokens.

export interface LocationObservation {
  serviceName: string;
  method: string;
  path: string; // request path, query removed
  status: number;
  requestHost: string; // request "Host" header
  forwardedProto: string | null; // request "X-Forwarded-Proto", if any
  locationOrigin: string; // e.g. "http://localhost:4000"
  locationPath: string; // query/fragment removed
  time: number;
}

// ── Unrouted request ───────────────────────────────────────────────────
// A request reached the proxy but no configured service handles its path.

/** Placeholder service name on request-log rows for unrouted requests. */
export const UNROUTED_SERVICE = "(no route)";

export interface RouteMissing {
  method: string;
  path: string; // query string removed
  time: number;
  routes: { name: string; pathPrefix: string | null }[]; // what IS configured
}

// ── Subresource scan (mixed content inside HTML/CSS bodies) ─────────────
// Emitted once per HTML/CSS response that was delivered over an HTTPS page.

export interface InsecureResource {
  url: string; // scheme+host+path only — query/fragment dropped (may hold tokens)
  source: string; // what loads it, e.g. "script src", "img srcset", "css url()"
  loopback: boolean; // points at localhost/127.0.0.1 (breaks on other devices)
}

export interface SubresourceScan {
  serviceName: string;
  path: string; // request path, query removed
  status: number;
  insecure: InsecureResource[]; // empty = scanned and clean
  incomplete: boolean; // scan stopped early (size cap or aborted response)
  time: number;
}

export type LoclynEvent =
  | { type: "connection:updated"; payload: ConnectionState }
  | { type: "service:updated"; payload: ServiceState }
  | { type: "diagnostic:updated"; payload: DiagnosticResult }
  | { type: "request:logged"; payload: RequestLogEntry }
  | { type: "proxy:forward-error"; payload: ProxyForwardError }
  | { type: "websocket:updated"; payload: WebSocketConnection }
  | { type: "log:entry"; payload: LogEntry }
  | { type: "settings:updated"; payload: LoclynSettings }
  | { type: "cors:observed"; payload: CorsObservation }
  | { type: "location:observed"; payload: LocationObservation }
  | { type: "route:missing"; payload: RouteMissing }
  | { type: "subresources:scanned"; payload: SubresourceScan };