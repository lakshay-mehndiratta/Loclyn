import { randomUUID } from "node:crypto";
import { LoclynEventBus } from "./event-bus.js";
import type { ConnectionState, LogLevel, LogSource, LoclynEvent } from "./types.js";

/**
 * LogCollector is a pure subscriber, like DiagnosticsEngine: it listens to
 * events that already exist and writes them down as human-readable log
 * lines (log:entry events). Nothing that produces those events had to
 * change. Per-request traffic is deliberately NOT logged here — that is
 * what the Requests page is for, and it would drown out everything else.
 *
 * These are Loclyn's own events. Loclyn does not start your apps, so it
 * never sees their console output.
 */
export class LogCollector {
  private lastConnection: ConnectionState | null = null;

  constructor(private bus: LoclynEventBus) {
    this.bus.on((event) => this.handleEvent(event));
  }

  private handleEvent(event: LoclynEvent): void {
    switch (event.type) {
      case "service:updated": {
        const s = event.payload;
        const running = s.status === "running";
        this.log(
          running ? "info" : "error",
          "service",
          `${s.name} (:${s.port}) is ${running ? "running" : "not responding"}`,
        );
        break;
      }

      case "connection:updated": {
        const c = event.payload;
        const prev = this.lastConnection;
        this.lastConnection = c;

        if (!prev || prev.proxy !== c.proxy) {
          this.log(c.proxy === "stopped" ? "warn" : "info", "proxy", `Proxy ${c.proxy}`);
        }
        if (!prev || prev.tunnel !== c.tunnel) {
          if (c.tunnel === "connected" && c.deviceUrl) {
            this.log("info", "tunnel", `Tunnel connected: ${c.deviceUrl}`);
          } else {
            this.log(c.tunnel === "disconnected" ? "warn" : "info", "tunnel", `Tunnel ${c.tunnel}`);
          }
        }
        break;
      }

      case "diagnostic:updated": {
        const d = event.payload;
        const level: LogLevel =
          d.severity === "ok" ? "info" : d.severity === "warning" ? "warn" : "error";
        this.log(level, "diagnostics", `${d.label} (${d.detail}): ${d.message ?? d.severity}`);
        break;
      }

      case "websocket:updated": {
        const w = event.payload;
        if (w.status === "connecting") break; // not an outcome yet
        if (w.status === "open") {
          this.log("info", "websocket", `WebSocket opened: ${w.path} → ${w.serviceName}`);
        } else if (w.status === "closed") {
          this.log("info", "websocket", `WebSocket closed: ${w.path} → ${w.serviceName}`);
        } else {
          this.log(
            "warn",
            "websocket",
            `WebSocket failed: ${w.path} → ${w.serviceName} (${w.reason ?? "unknown reason"})`,
          );
        }
        break;
      }

      case "proxy:forward-error": {
        const e = event.payload;
        this.log("error", "proxy", `Could not forward to ${e.serviceName} (:${e.port}): ${e.code}`);
        break;
      }

      // Everything else (including our own log:entry events) is ignored.
      // Ignoring log:entry is what stops this subscriber from looping.
      default:
        break;
    }
  }

  private log(level: LogLevel, source: LogSource, message: string): void {
    this.bus.emit({
      type: "log:entry",
      payload: { id: randomUUID(), time: Date.now(), level, source, message },
    });
  }
}