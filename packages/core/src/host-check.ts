import http from "node:http";
import type { LoclynEventBus } from "./event-bus.js";
import type { ServiceRegistry } from "./service-registry.js";
import type { DiagnosticResult, ServiceState } from "./types.js";

interface ProbeResult {
  status: number;
}

/** Sends one GET straight to a local dev server with optional Host/Origin overrides. */
function probe(
  port: number,
  path: string,
  headers: Record<string, string>,
  timeoutMs = 2000,
): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers, timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

/**
 * Dev servers (Vite, Next) can refuse requests that arrive with the tunnel's
 * hostname. We detect it by DIFFERENTIAL probing: ask the dev server the same
 * thing twice — once as "localhost", once pretending to be the tunnel — and
 * only report when the tunnel version is refused (403) and the localhost
 * version is not. Observed directly, so confidence is "high".
 */
export class HostCheckProbe {
  private tunnelHost: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastKey = new Map<string, string>();

  constructor(
    private bus: LoclynEventBus,
    private registry: ServiceRegistry,
    private intervalMs = 10_000,
  ) {
    bus.on((event) => {
      if (event.type !== "connection:updated") return;
      const url = event.payload.deviceUrl;
      if (!url) return;
      let host: string;
      try {
        host = new URL(url).host;
      } catch {
        return;
      }
      if (host !== this.tunnelHost) {
        this.tunnelHost = host;
        void this.checkNow();
      }
    });
    this.timer = setInterval(() => void this.checkNow(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkNow(): Promise<void> {
    if (this.running || !this.tunnelHost) return;
    this.running = true;
    try {
      for (const svc of this.registry.list()) {
        if (svc.type !== "frontend" || svc.status !== "running") continue;
        await this.checkService(svc, this.tunnelHost);
      }
    } finally {
      this.running = false;
    }
  }

  private async checkService(svc: ServiceState, tunnelHost: string): Promise<void> {
    const origin = `https://${tunnelHost}`;
    const hmr = "/_next/webpack-hmr";
    const [baseDoc, tunnelDoc, baseRes, tunnelRes] = await Promise.all([
      probe(svc.port, "/", { Host: `localhost:${svc.port}` }),
      probe(svc.port, "/", { Host: tunnelHost }),
      probe(svc.port, hmr, { Host: `localhost:${svc.port}` }),
      probe(svc.port, hmr, { Host: `localhost:${svc.port}`, Origin: origin }),
    ]);
    if (!baseDoc || !tunnelDoc || !baseRes || !tunnelRes) return; // can't tell — stay silent

    const hostBlocked = tunnelDoc.status === 403 && baseDoc.status !== 403;
    const originBlocked = tunnelRes.status === 403 && baseRes.status !== 403;

    if (hostBlocked || originBlocked) {
      this.emit(svc, "error", this.message(svc, tunnelHost, hostBlocked));
    } else if (baseDoc.status > 0 && baseDoc.status < 500) {
      this.emit(svc, "ok", undefined);
    }
  }

  private message(svc: ServiceState, tunnelHost: string, byHost: boolean): string {
    const fw = (svc.framework ?? "").toLowerCase();
    const how = byHost ? "Host header" : "Origin header";
    if (fw.includes("vite")) {
      return `Vite is refusing requests for '${tunnelHost}' (${how}). Add to vite.config: server: { allowedHosts: [".trycloudflare.com"] } and restart Vite.`;
    }
    if (fw.includes("next")) {
      return `Next.js is refusing dev requests from '${tunnelHost}' (${how}). Add to next.config: allowedDevOrigins: ["*.trycloudflare.com"] and restart Next.`;
    }
    return `'${svc.name}' answers 403 when reached as '${tunnelHost}' but works on localhost (${how}). Its dev server likely has a host/origin allowlist — add the tunnel domain to it.`;
  }

  private emit(svc: ServiceState, severity: "ok" | "error", message?: string): void {
    const key = `${severity}|${message ?? ""}`;
    if (this.lastKey.get(svc.name) === key) return;
    this.lastKey.set(svc.name, key);
    const result: DiagnosticResult = {
      id: "dev-server-host-check",
      label: "Dev Server Host Check",
      detail: svc.name,
      severity,
      confidence: "high",
      message,
      updatedAt: Date.now(),
    };
    this.bus.emit({ type: "diagnostic:updated", payload: result });
  }
}