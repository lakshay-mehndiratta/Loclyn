import { describe, expect, it } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { MixedContentAnalyzer, judgeRedirect } from "./mixed-content.js";
import type { DiagnosticResult, LocationObservation } from "./types.js";

function obs(p: Partial<LocationObservation> = {}): LocationObservation {
  return {
    serviceName: "api", method: "GET", path: "/old", status: 302,
    requestHost: "abc-def.trycloudflare.com", forwardedProto: "https",
    locationOrigin: "https://abc-def.trycloudflare.com", locationPath: "/new", time: 1, ...p,
  };
}

describe("judgeRedirect", () => {
  it("ignores plain local use", () => {
    expect(judgeRedirect(obs({ requestHost: "localhost:4020", forwardedProto: null, locationOrigin: "http://localhost:4000" }))).toBe("not-applicable");
  });
  it("flags a localhost redirect on a tunnel request", () => {
    expect(judgeRedirect(obs({ locationOrigin: "http://localhost:4000" }))).toBe("localhost-leak");
    expect(judgeRedirect(obs({ locationOrigin: "http://127.0.0.1:4000" }))).toBe("localhost-leak");
  });
  it("flags an http redirect on an https request", () => {
    expect(judgeRedirect(obs({ locationOrigin: "http://abc-def.trycloudflare.com" }))).toBe("insecure-redirect");
  });
  it("accepts an https redirect on the tunnel host", () => {
    expect(judgeRedirect(obs())).toBe("ok");
  });
  it("detects the tunnel by hostname even without X-Forwarded-Proto", () => {
    expect(judgeRedirect(obs({ forwardedProto: null, locationOrigin: "http://localhost:4000" }))).toBe("localhost-leak");
  });
});

describe("MixedContentAnalyzer", () => {
  function setup() {
    const bus = new LoclynEventBus();
    const got: DiagnosticResult[] = [];
    bus.on((e) => e.type === "diagnostic:updated" && got.push(e.payload));
    new MixedContentAnalyzer(bus);
    return { bus, got };
  }
  it("warns then returns to ok, without repeating", () => {
    const { bus, got } = setup();
    bus.emit({ type: "location:observed", payload: obs({ locationOrigin: "http://localhost:4000" }) });
    bus.emit({ type: "location:observed", payload: obs({ locationOrigin: "http://localhost:4000" }) });
    bus.emit({ type: "location:observed", payload: obs() });
    expect(got.map((g) => g.severity)).toEqual(["warning", "ok"]);
    expect(got[0].id).toBe("https-mixed-content");
    expect(got[0].confidence).toBe("medium");
  });
  it("is silent for local-only traffic", () => {
    const { bus, got } = setup();
    bus.emit({ type: "location:observed", payload: obs({ requestHost: "localhost:4020", forwardedProto: null, locationOrigin: "http://localhost:4000" }) });
    expect(got).toHaveLength(0);
  });
});

describe("judgeRedirect — explicit scheme beats the hostname guess", () => {
  it("a tunnel host that explicitly says http is not treated as an https page", () => {
    expect(judgeRedirect(obs({ forwardedProto: "http", locationOrigin: "http://abc-def.trycloudflare.com" }))).toBe("ok");
  });
});

describe("MixedContentAnalyzer — page scans and redirects share one row", () => {
  function setup() {
    const bus = new LoclynEventBus();
    const got: DiagnosticResult[] = [];
    bus.on((e) => e.type === "diagnostic:updated" && got.push(e.payload));
    new MixedContentAnalyzer(bus);
    return { bus, got };
  }
  const scan = (insecure: { url: string; source: string; loopback: boolean }[], path = "/") => ({
    type: "subresources:scanned" as const,
    payload: { serviceName: "web", path, status: 200, insecure, incomplete: false, time: 1 },
  });
  const bad = { url: "http://cdn.example.com/app.js", source: "script src", loopback: false };

  it("warns naming the service and URL, then clears when the page is clean", () => {
    const { bus, got } = setup();
    bus.emit(scan([bad]));
    bus.emit(scan([bad])); // identical → silent
    bus.emit(scan([]));
    expect(got.map((g) => g.severity)).toEqual(["warning", "ok"]);
    expect(got[0].detail).toBe("web");
    expect(got[0].message).toContain("script src http://cdn.example.com/app.js");
    expect(got[0].confidence).toBe("medium");
  });

  it("a clean page elsewhere does not clear another page's problem", () => {
    const { bus, got } = setup();
    bus.emit(scan([bad], "/a"));
    bus.emit(scan([], "/b"));
    expect(got.map((g) => g.severity)).toEqual(["warning"]);
    bus.emit(scan([], "/a"));
    expect(got.map((g) => g.severity)).toEqual(["warning", "ok"]);
  });

  it("a clean redirect cannot overwrite an open resource warning", () => {
    const { bus, got } = setup();
    bus.emit(scan([bad]));
    bus.emit({ type: "location:observed", payload: obs({ serviceName: "web" }) }); // clean https redirect
    expect(got.map((g) => g.severity)).toEqual(["warning"]);
  });

  it("mentions localhost when a resource points at it", () => {
    const { bus, got } = setup();
    bus.emit(scan([{ url: "http://localhost:4000/a.png", source: "img src", loopback: true }]));
    expect(got[0].message).toContain("localhost");
  });
});