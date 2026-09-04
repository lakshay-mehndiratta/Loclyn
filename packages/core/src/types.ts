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
  | "tunnel-availability";

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

export type LoclynEvent =
  | { type: "connection:updated"; payload: ConnectionState }
  | { type: "service:updated"; payload: ServiceState }
  | { type: "diagnostic:updated"; payload: DiagnosticResult }
  | { type: "request:logged"; payload: RequestLogEntry };