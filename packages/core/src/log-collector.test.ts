import { describe, it, expect, beforeEach } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { LogCollector } from "./log-collector.js";
import type { LogEntry, ServiceState, WebSocketConnection } from "./types.js";

let bus: LoclynEventBus;
let logs: LogEntry[];

beforeEach(() => {
  bus = new LoclynEventBus();
  logs = [];
  bus.on((event) => {
    if (event.type === "log:entry") logs.push(event.payload);
  });
  new LogCollector(bus);
});

function ws(overrides: Partial<WebSocketConnection>): WebSocketConnection {
  return {
    id: "ws-1",
    serviceName: "frontend",
    path: "/hmr",
    status: "open",
    startedAt: 1,
    openedAt: 1,
    closedAt: null,
    ...overrides,
  };
}

describe("LogCollector", () => {
  it("logs a running service as info and an unreachable one as error", () => {
    const base = { name: "frontend", type: "frontend", port: 5173 };
    bus.emit({ type: "service:updated", payload: { ...base, status: "running" } as ServiceState });
    bus.emit({ type: "service:updated", payload: { ...base, status: "unreachable" } as ServiceState });

    expect(logs[0]).toMatchObject({ level: "info", source: "service" });
    expect(logs[1]).toMatchObject({ level: "error", source: "service" });
    expect(logs[1].message).toContain("not responding");
  });

  it("logs tunnel changes only when the tunnel state changes", () => {
    const conn = {
      tunnel: "connecting",
      proxy: "running",
      ssl: "inactive",
      deviceUrl: null,
      startedAt: null,
    } as const;
    bus.emit({ type: "connection:updated", payload: { ...conn } });
    bus.emit({ type: "connection:updated", payload: { ...conn } }); // no change
    bus.emit({
      type: "connection:updated",
      payload: { ...conn, tunnel: "connected", deviceUrl: "https://x.trycloudflare.com" },
    });

    const tunnelLogs = logs.filter((l) => l.source === "tunnel");
    expect(tunnelLogs).toHaveLength(2); // connecting, then connected
    expect(tunnelLogs[1].message).toContain("https://x.trycloudflare.com");
  });

  it("maps diagnostic severity to log level", () => {
    const base = { id: "api-connectivity", label: "API Connectivity", detail: "x", confidence: "high", updatedAt: 1 } as const;
    bus.emit({ type: "diagnostic:updated", payload: { ...base, severity: "warning", message: "slow" } });
    bus.emit({ type: "diagnostic:updated", payload: { ...base, severity: "error", message: "down" } });

    expect(logs[0].level).toBe("warn");
    expect(logs[1].level).toBe("error");
  });

  it("logs websocket outcomes but not the connecting step", () => {
    bus.emit({ type: "websocket:updated", payload: ws({ status: "connecting", openedAt: null }) });
    bus.emit({ type: "websocket:updated", payload: ws({ status: "open" }) });
    bus.emit({
      type: "websocket:updated",
      payload: ws({ id: "ws-2", status: "failed", openedAt: null, reason: "refused" }),
    });

    expect(logs).toHaveLength(2);
    expect(logs[0].message).toContain("opened");
    expect(logs[1]).toMatchObject({ level: "warn" });
    expect(logs[1].message).toContain("refused");
  });

  it("logs proxy forwarding errors as errors", () => {
    bus.emit({
      type: "proxy:forward-error",
      payload: { serviceName: "backend", port: 3000, code: "ECONNREFUSED", time: 1 },
    });
    expect(logs[0]).toMatchObject({ level: "error", source: "proxy" });
    expect(logs[0].message).toContain("ECONNREFUSED");
  });

  it("does not log individual requests and does not loop on its own entries", () => {
    bus.emit({
      type: "request:logged",
      payload: {
        id: "r1", time: 1, method: "GET", path: "/", status: 200,
        serviceName: "frontend", type: "document", sizeBytes: null, durationMs: 1,
      },
    });
    expect(logs).toHaveLength(0);
  });
});