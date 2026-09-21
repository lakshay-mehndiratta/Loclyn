import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Server,
  Plug,
  Cable,
  ShieldAlert,
  ShieldCheck,
  DoorClosed,
  Network,
} from "lucide-react";
import {
  SiReact,
  SiVite,
  SiExpress,
  SiNodedotjs,
  SiNextdotjs,
  SiJavascript,
} from "react-icons/si";
import type { IconType } from "react-icons";
import type { DiagnosticId, DiagnosticSeverity, ServiceStatus } from "@loclyn/core";

// ── Framework icon, matched by whatever string the service reports ────────
// Unknown/missing frameworks fall back to a plain generic mark rather than
// guessing — we only show a real logo when we actually know the framework.

const FRAMEWORK_ICONS: Record<string, { icon: IconType; color: string }> = {
  react: { icon: SiReact, color: "#61dafb" },
  vite: { icon: SiVite, color: "#bd34fe" },
  express: { icon: SiExpress, color: "#ffffff" },
  node: { icon: SiNodedotjs, color: "#3c873a" },
  "node.js": { icon: SiNodedotjs, color: "#3c873a" },
  next: { icon: SiNextdotjs, color: "#ffffff" },
  "next.js": { icon: SiNextdotjs, color: "#ffffff" },
  javascript: { icon: SiJavascript, color: "#f7df1e" },
};

export function FrameworkIcon({ framework }: { framework: string }) {
  const normalized = framework.toLowerCase();
  // Match by substring, not exact equality — a real project's framework
  // string can carry extra context (e.g. "Vite (fake)" from the demo
  // harness, or eventually a detected version string), so we look for a
  // known key contained anywhere in the reported value rather than
  // requiring it to match exactly.
  const key = Object.keys(FRAMEWORK_ICONS).find((k) => normalized.includes(k));
  const match = key ? FRAMEWORK_ICONS[key] : undefined;
  if (!match) return null;
  const Icon = match.icon;
  return <Icon size={14} color={match.color} style={{ flexShrink: 0 }} />;
}

// ── Diagnostic severity icon — colored, matched to severity meaning ───────

const SEVERITY_ICON: Record<DiagnosticSeverity, { icon: LucideIcon; className: string }> = {
  ok: { icon: CheckCircle2, className: "icon-ok" },
  warning: { icon: AlertTriangle, className: "icon-warning" },
  error: { icon: XCircle, className: "icon-error" },
};

export function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  const match = SEVERITY_ICON[severity] ?? { icon: HelpCircle, className: "icon-unknown" };
  const Icon = match.icon;
  return <Icon size={16} strokeWidth={2} className={match.className} />;
}

// ── Service status icon — reuses the same visual language as severity ─────

export function ServiceStatusIcon({ status }: { status: ServiceStatus }) {
  const isRunning = status === "running";
  const Icon = isRunning ? CheckCircle2 : XCircle;
  return <Icon size={16} strokeWidth={2} className={isRunning ? "icon-ok" : "icon-error"} />;
}

// ── HTTP method badge, colored by method ───────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET: "method-get",
  POST: "method-post",
  PUT: "method-put",
  PATCH: "method-put",
  DELETE: "method-delete",
  WS: "method-ws",
};

export function MethodBadge({ method }: { method: string }) {
  const className = METHOD_COLORS[method.toUpperCase()] ?? "method-default";
  return <span className={`method-badge ${className}`}>{method}</span>;
}

// ── HTTP status code badge, colored by range ───────────────────────────────

export function StatusBadge({ status }: { status: number }) {
  let className = "status-badge-ok";
  if (status >= 500) className = "status-badge-error";
  else if (status >= 400) className = "status-badge-warning";
  else if (status === 101) className = "status-badge-info";

  return <span className={`status-badge ${className}`}>{status}</span>;
}

// ── Diagnostic type icon — identifies WHAT is being checked, independent
// of its current severity (severity is shown separately via SeverityBadge
// below). Falls back to a generic icon for any diagnostic id not in this
// map, rather than showing nothing.

const DIAGNOSTIC_TYPE_ICONS: Record<DiagnosticId, LucideIcon> = {
  "http-requests": Server,
  "api-connectivity": Plug,
  "websocket-hmr": Cable,
  cors: ShieldAlert,
  "https-mixed-content": ShieldCheck,
  "port-in-use": DoorClosed,
  "tunnel-availability": Network,
  "ipv4-ipv6-mismatch": Network,
};

export function DiagnosticTypeIcon({ id }: { id: DiagnosticId }) {
  const Icon = DIAGNOSTIC_TYPE_ICONS[id] ?? HelpCircle;
  return <Icon size={16} strokeWidth={1.75} color="#60a5fa" style={{ flexShrink: 0 }} />;
}

// ── Severity badge — icon tightly paired with its label text ("OK",
// "Warning", "Error"), colored to match. Replaces plain lowercase
// severity text in diagnostic rows.

const SEVERITY_BADGE: Record<DiagnosticSeverity, { icon: LucideIcon; label: string; className: string }> = {
  ok: { icon: CheckCircle2, label: "OK", className: "severity-badge-ok" },
  warning: { icon: AlertTriangle, label: "Warning", className: "severity-badge-warning" },
  error: { icon: XCircle, label: "Error", className: "severity-badge-error" },
};

export function SeverityBadge({ severity }: { severity: DiagnosticSeverity }) {
  const match = SEVERITY_BADGE[severity];
  const Icon = match.icon;
  return (
    <span className={`severity-badge ${match.className}`}>
      <Icon size={15} strokeWidth={2} />
      {match.label}
    </span>
  );
}