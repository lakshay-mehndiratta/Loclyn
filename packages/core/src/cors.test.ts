import { describe, expect, it } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { CorsAnalyzer, judgeCors } from "./cors.js";
import type { CorsObservation, DiagnosticResult } from "./types.js";

function obs(partial: Partial<CorsObservation> = {}): CorsObservation {
  return {
    serviceName: "api",
    method: "GET",
    path: "/api/posts",
    status: 200,
    origin: "http://localhost:3000",
    host: "abc.trycloudflare.com",
    isPreflight: false,
    allowOrigin: null,
    time: 1,
    ...partial,
  };
}

describe("judgeCors", () => {
  it("ignores same-origin requests", () => {
    expect(judgeCors(obs({ origin: "https://abc.trycloudflare.com" }))).toBe("same-origin");
  });
  it("accepts a matching or wildcard allow-origin", () => {
    expect(judgeCors(obs({ allowOrigin: "http://localhost:3000" }))).toBe("ok");
    expect(judgeCors(obs({ allowOrigin: "*" }))).toBe("ok");
  });
  it("flags a missing allow-origin", () => {
    expect(judgeCors(obs())).toBe("missing-allow-origin");
  });
  it("flags a mismatched allow-origin", () => {
    expect(judgeCors(obs({ allowOrigin: "http://other.com" }))).toBe("missing-allow-origin");
  });
  it("flags a failed preflight and accepts a good one", () => {
    expect(judgeCors(obs({ isPreflight: true, method: "OPTIONS", status: 404 }))).toBe("preflight-failed");
    expect(judgeCors(obs({ isPreflight: true, method: "OPTIONS", status: 204, allowOrigin: "*" }))).toBe("ok");
  });
});

describe("CorsAnalyzer", () => {
  function setup() {
    const bus = new LoclynEventBus();
    const got: DiagnosticResult[] = [];
    bus.on((e) => e.type === "diagnostic:updated" && got.push(e.payload));
    new CorsAnalyzer(bus);
    return { bus, got };
  }

  it("emits a medium-confidence warning, then ok, without repeating", () => {
    const { bus, got } = setup();
    bus.emit({ type: "cors:observed", payload: obs() });
    bus.emit({ type: "cors:observed", payload: obs() }); // duplicate → silent
    bus.emit({ type: "cors:observed", payload: obs({ allowOrigin: "*" }) });
    expect(got.map((g) => g.severity)).toEqual(["warning", "ok"]);
    expect(got[0].confidence).toBe("medium");
    expect(got[0].id).toBe("cors");
  });

  it("emits nothing for same-origin traffic", () => {
    const { bus, got } = setup();
    bus.emit({ type: "cors:observed", payload: obs({ origin: "https://abc.trycloudflare.com" }) });
    expect(got).toHaveLength(0);
  });
});