import { describe, it, expect, beforeEach } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { DiagnosticsEngine } from "./diagnostics.js";
import type { LoclynEvent, DiagnosticResult, RequestLogEntry } from "./types.js";

let bus: LoclynEventBus;
let emitted: DiagnosticResult[];

beforeEach(() => {
  bus = new LoclynEventBus();
  emitted = [];

  // Collect every diagnostic:updated event the engine produces, in order —
  // this is our test's only window into the engine's behavior, exactly
  // how a real subscriber (the CLI, the dashboard) would consume it.
  bus.on((event: LoclynEvent) => {
    if (event.type === "diagnostic:updated") emitted.push(event.payload);
  });

  new DiagnosticsEngine(bus);
});

function requestEntry(overrides: Partial<RequestLogEntry>): RequestLogEntry {
  return {
    id: "test-id",
    time: Date.now(),
    method: "GET",
    path: "/",
    status: 200,
    serviceName: "backend",
    type: "fetch",
    sizeBytes: null,
    durationMs: 10,
    ...overrides,
  };
}

describe("DiagnosticsEngine — api-connectivity", () => {
  it("reports ok for a running service, with high confidence", () => {
    bus.emit({
      type: "service:updated",
      payload: { name: "backend", type: "backend", port: 3000, status: "running", lastCheckedAt: Date.now() },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].id).toBe("api-connectivity");
    expect(emitted[0].severity).toBe("ok");
    expect(emitted[0].confidence).toBe("high");
  });

  it("reports error for an unreachable service, with a message naming it", () => {
    bus.emit({
      type: "service:updated",
      payload: { name: "backend", type: "backend", port: 3000, status: "unreachable", lastCheckedAt: Date.now() },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].severity).toBe("error");
    expect(emitted[0].message).toContain("backend");
    expect(emitted[0].message).toContain("3000");
  });

  it("does not re-emit when the status has not actually changed", () => {
    const payload = { name: "backend", type: "backend" as const, port: 3000, status: "running" as const, lastCheckedAt: Date.now() };

    bus.emit({ type: "service:updated", payload });
    bus.emit({ type: "service:updated", payload: { ...payload, lastCheckedAt: Date.now() + 1000 } });

    // Same severity both times ("running" -> "ok") — should only emit once.
    expect(emitted).toHaveLength(1);
  });

  it("emits again when status genuinely flips back and forth", () => {
    const base = { name: "backend", type: "backend" as const, port: 3000, lastCheckedAt: Date.now() };

    bus.emit({ type: "service:updated", payload: { ...base, status: "running" } });
    bus.emit({ type: "service:updated", payload: { ...base, status: "unreachable" } });
    bus.emit({ type: "service:updated", payload: { ...base, status: "running" } });

    expect(emitted).toHaveLength(3);
    expect(emitted.map((d) => d.severity)).toEqual(["ok", "error", "ok"]);
  });
});

describe("DiagnosticsEngine — http-requests", () => {
  it("reports ok, with medium confidence, when there are no errors in the window", () => {
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 200 }) });

    const httpDiagnostics = emitted.filter((d) => d.id === "http-requests");
    expect(httpDiagnostics).toHaveLength(1);
    expect(httpDiagnostics[0].severity).toBe("ok");
    expect(httpDiagnostics[0].confidence).toBe("medium");
  });

  it("escalates to warning after exactly one 500+ response in the window", () => {
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 200 }) });
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 502 }) });

    const httpDiagnostics = emitted.filter((d) => d.id === "http-requests");
    expect(httpDiagnostics.at(-1)?.severity).toBe("warning");
  });

  it("escalates to error after two or more 500+ responses in the window", () => {
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 200 }) });
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 502 }) });
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 500 }) });

    const httpDiagnostics = emitted.filter((d) => d.id === "http-requests");
    expect(httpDiagnostics.at(-1)?.severity).toBe("error");
  });

  it("does not re-emit for a third error once already at error severity", () => {
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 502 }) });
    bus.emit({ type: "request:logged", payload: requestEntry({ status: 500 }) });
    const countAtError = emitted.filter((d) => d.id === "http-requests").length;

    bus.emit({ type: "request:logged", payload: requestEntry({ status: 503 }) });
    const countAfterThird = emitted.filter((d) => d.id === "http-requests").length;

    expect(countAfterThird).toBe(countAtError);
  });

  it("tracks each service's request window independently", () => {
    bus.emit({ type: "request:logged", payload: requestEntry({ serviceName: "frontend", status: 200 }) });
    bus.emit({ type: "request:logged", payload: requestEntry({ serviceName: "backend", status: 500 }) });
    bus.emit({ type: "request:logged", payload: requestEntry({ serviceName: "backend", status: 500 }) });

    const frontendDiagnostics = emitted.filter((d) => d.id === "http-requests" && d.detail.includes("frontend"));
    const backendDiagnostics = emitted.filter((d) => d.id === "http-requests" && d.detail.includes("backend"));

    expect(frontendDiagnostics.at(-1)?.severity).toBe("ok");
    expect(backendDiagnostics.at(-1)?.severity).toBe("error");
  });
});

describe("DiagnosticsEngine — websocket-hmr", () => {
  it("reports ok with medium confidence once a websocket request is seen", () => {
    bus.emit({
      type: "request:logged",
      payload: requestEntry({ type: "websocket", status: 101, durationMs: null, sizeBytes: null }),
    });

    const wsDiagnostics = emitted.filter((d) => d.id === "websocket-hmr");
    expect(wsDiagnostics).toHaveLength(1);
    expect(wsDiagnostics[0].severity).toBe("ok");
    expect(wsDiagnostics[0].confidence).toBe("medium");
  });

  it("does not count a websocket request toward the http-requests window", () => {
    bus.emit({
      type: "request:logged",
      payload: requestEntry({ type: "websocket", status: 101, durationMs: null, sizeBytes: null }),
    });

    const httpDiagnostics = emitted.filter((d) => d.id === "http-requests");
    expect(httpDiagnostics).toHaveLength(0);
  });
});