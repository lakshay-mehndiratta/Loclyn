import type { LoclynEventBus } from "./event-bus.js";
import type { DiagnosticResult, LocationObservation, SubresourceScan } from "./types.js";

export type RedirectVerdict = "not-applicable" | "ok" | "localhost-leak" | "insecure-redirect";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function hostname(hostWithPort: string): string {
  // "localhost:4020" -> "localhost"; "[::1]:4020" -> "[::1]"
  if (hostWithPort.startsWith("[")) return hostWithPort.slice(0, hostWithPort.indexOf("]") + 1);
  return hostWithPort.split(":")[0].toLowerCase();
}

/**
 * Judges ONE redirect seen on a response. We only see the Location header,
 * never what the browser then does, so findings are "medium" confidence.
 *
 *  - Request came in on localhost over plain http → local use, not applicable.
 *  - Redirect points at localhost/127.0.0.1 although the request came through
 *    the tunnel → "localhost-leak": the phone/other device will try ITS OWN
 *    localhost and fail.
 *  - Request came in over https (tunnel) but the redirect goes to http:// →
 *    "insecure-redirect": the browser downgrades or blocks it as mixed content.
 */
export function judgeRedirect(o: LocationObservation): RedirectVerdict {
  const reqHost = hostname(o.requestHost);
  // An explicit scheme header always wins; the hostname is only a fallback
  // when the tunnel sent no scheme information at all.
  const viaHttps =
    o.forwardedProto === "https" || (o.forwardedProto === null && reqHost.endsWith(".trycloudflare.com"));
  const viaLoopback = LOOPBACK.has(reqHost);
  if (viaLoopback && !viaHttps) return "not-applicable";

  let target: URL;
  try {
    target = new URL(o.locationOrigin);
  } catch {
    return "not-applicable";
  }
  if (LOOPBACK.has(hostname(target.host))) return "localhost-leak";
  if (viaHttps && target.protocol === "http:") return "insecure-redirect";
  return "ok";
}

/**
 * One row per service, fed by two kinds of evidence:
 *  - redirects (location:observed): a Location header that leaks localhost or downgrades to http
 *  - page contents (subresources:scanned): http:// resources inside an HTTPS page's HTML/CSS
 * The row is a warning while EITHER source has an open problem, so one source
 * can never overwrite the other's warning by reporting "ok".
 */
interface ServiceIssues {
  redirect: string | null;
  pages: Map<string, string>; // request path -> problem message
  lastKey: string | null;
}

const MAX_TRACKED_PAGES = 50;

export class MixedContentAnalyzer {
  private services = new Map<string, ServiceIssues>();

  constructor(private bus: LoclynEventBus) {
    bus.on((event) => {
      if (event.type === "location:observed") this.handleRedirect(event.payload);
      if (event.type === "subresources:scanned") this.handleScan(event.payload);
    });
  }

  private issues(service: string): ServiceIssues {
    let s = this.services.get(service);
    if (!s) {
      s = { redirect: null, pages: new Map(), lastKey: null };
      this.services.set(service, s);
    }
    return s;
  }

  private handleRedirect(o: LocationObservation): void {
    const verdict = judgeRedirect(o);
    if (verdict === "not-applicable") return;
    const s = this.issues(o.serviceName);
    s.redirect = verdict === "ok" ? null : this.explainRedirect(verdict, o);
    this.publish(o.serviceName, s);
  }

  private handleScan(o: SubresourceScan): void {
    const s = this.issues(o.serviceName);
    if (o.insecure.length > 0) {
      s.pages.delete(o.path); // re-insert so the newest problem is last
      s.pages.set(o.path, this.explainResources(o));
      if (s.pages.size > MAX_TRACKED_PAGES) {
        const oldest = s.pages.keys().next().value;
        if (oldest !== undefined) s.pages.delete(oldest);
      }
    } else {
      s.pages.delete(o.path); // this page is clean now
    }
    this.publish(o.serviceName, s);
  }

  private publish(service: string, s: ServiceIssues): void {
    const pageMessages = [...s.pages.values()];
    const message = pageMessages.length > 0 ? pageMessages[pageMessages.length - 1] : s.redirect;
    const key = message ?? "ok";
    if (s.lastKey === key) return;
    s.lastKey = key;

    const result: DiagnosticResult = {
      id: "https-mixed-content",
      label: "HTTPS / Mixed Content",
      detail: service,
      severity: message ? "warning" : "ok",
      message: message ?? undefined,
      confidence: "medium",
      updatedAt: Date.now(),
    };
    this.bus.emit({ type: "diagnostic:updated", payload: result });
  }

  private explainResources(o: SubresourceScan): string {
    const shown = o.insecure.slice(0, 3).map((r) => `${r.source} ${r.url}`).join(", ");
    const more = o.insecure.length > 3 ? ` (+${o.insecure.length - 3} more)` : "";
    const hasLoopback = o.insecure.some((r) => r.loopback);
    const why = hasLoopback
      ? `Some point at localhost, which a phone or other device would look for on ITSELF, and plain http is mixed content on an https page. Use https:// URLs, or relative / protocol-relative ones.`
      : `Browsers block or upgrade plain-http resources on an https page (mixed content). Use https:// URLs, or relative / protocol-relative ones.`;
    return `"${o.serviceName}" served ${o.path} over https, but it loads insecure resources: ${shown}${more}. ${why}`;
  }

  private explainRedirect(verdict: RedirectVerdict, o: LocationObservation): string {
    const where = `${o.status} redirect from ${o.path} to ${o.locationOrigin}${o.locationPath}`;
    if (verdict === "localhost-leak") {
      return `${where} — that is a localhost address, but this request came through the tunnel, so a phone or other device would look for localhost on ITSELF and fail. Make "${o.serviceName}" build redirect URLs from the request's Host / X-Forwarded-Host (for Express: app.set("trust proxy", true)) or use relative redirects.`;
    }
    return `${where} — the page was loaded over https, but this redirect goes to plain http, which browsers downgrade or block as mixed content. Make "${o.serviceName}" honour X-Forwarded-Proto (for Express: app.set("trust proxy", true)) or use relative redirects.`;
  }
}