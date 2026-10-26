import type { LoclynEventBus } from "./event-bus.js";
import type { CorsObservation, DiagnosticResult } from "./types.js";

export type CorsVerdict = "same-origin" | "ok" | "missing-allow-origin" | "preflight-failed";

/**
 * Judges ONE observed request. We never see the browser's own verdict, only
 * the headers that crossed the proxy, so findings are "medium" confidence.
 *
 *  - Origin host equals Host  → same-origin (typical for page + API both
 *    served through the tunnel) → nothing to check.
 *  - Preflight (OPTIONS) answered with an error, or without a matching
 *    Access-Control-Allow-Origin → the browser will block the real request.
 *  - Normal cross-origin request whose response lacks a matching
 *    Access-Control-Allow-Origin → the browser will hide the response.
 */
export function judgeCors(o: CorsObservation): CorsVerdict {
  let originHost: string;
  try {
    originHost = new URL(o.origin).host;
  } catch {
    originHost = o.origin; // e.g. the literal "null" origin
  }
  if (originHost === o.host) return "same-origin";

  const allowed = o.allowOrigin === "*" || o.allowOrigin === o.origin;
  if (o.isPreflight) {
    return o.status >= 200 && o.status < 300 && allowed ? "ok" : "preflight-failed";
  }
  return allowed ? "ok" : "missing-allow-origin";
}

export class CorsAnalyzer {
  private lastKey = new Map<string, string>();

  constructor(private bus: LoclynEventBus) {
    bus.on((event) => {
      if (event.type === "cors:observed") this.handle(event.payload);
    });
  }

  private handle(o: CorsObservation): void {
    const verdict = judgeCors(o);
    if (verdict === "same-origin") return;

    const ok = verdict === "ok";
    const message = ok ? undefined : this.explain(verdict, o);
    const key = ok ? "ok" : `warning|${verdict}|${o.origin}|${o.path}`;
    if (this.lastKey.get(o.serviceName) === key) return;
    this.lastKey.set(o.serviceName, key);

    const result: DiagnosticResult = {
      id: "cors",
      label: "CORS",
      detail: o.serviceName,
      severity: ok ? "ok" : "warning",
      message,
      confidence: "medium",
      updatedAt: Date.now(),
    };
    this.bus.emit({ type: "diagnostic:updated", payload: result });
  }

  private explain(verdict: CorsVerdict, o: CorsObservation): string {
    if (verdict === "preflight-failed") {
      return `Preflight (OPTIONS ${o.path}) from origin ${o.origin} got ${o.status} without a matching Access-Control-Allow-Origin, so the browser will block the real request. Allow this origin (and the methods/headers it asks for) in "${o.serviceName}"'s CORS settings.`;
    }
    return `Cross-origin ${o.method} ${o.path} from ${o.origin} came back without a matching Access-Control-Allow-Origin, so the browser will hide the response. Allow this origin in "${o.serviceName}"'s CORS settings.`;
  }
}