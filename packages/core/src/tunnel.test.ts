import { describe, it, expect } from "vitest";
import { LoclynEventBus } from "./event-bus.js";
import { TunnelManager, cloudflaredInstallHint } from "./tunnel.js";
import type { DiagnosticResult, LoclynEvent } from "./types.js";

describe("cloudflaredInstallHint", () => {
  it("gives the brew command on macOS", () => {
    expect(cloudflaredInstallHint("darwin")).toContain("brew install cloudflared");
  });
  it("gives the winget command on Windows", () => {
    expect(cloudflaredInstallHint("win32")).toContain("winget install");
  });
  it("points to the download page on Linux", () => {
    expect(cloudflaredInstallHint("linux")).toContain("https://");
  });
});

describe("TunnelManager when the binary is missing", () => {
  it("emits a tunnel-availability error diagnostic", async () => {
    const bus = new LoclynEventBus();
    const diagnostics: DiagnosticResult[] = [];
    bus.on((event: LoclynEvent) => {
      if (event.type === "diagnostic:updated") diagnostics.push(event.payload);
    });

    const tunnel = new TunnelManager(bus, "loclyn-no-such-binary");
    tunnel.start(4020);
    await new Promise((r) => setTimeout(r, 300));

    const d = diagnostics.find((x) => x.id === "tunnel-availability");
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("not installed");
  });
});