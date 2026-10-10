import { describe, it, expect } from "vitest";
import { detectFromPackageJson, parsePortFlag } from "./detect.js";

describe("parsePortFlag", () => {
  it("reads '-p 3001'", () => {
    expect(parsePortFlag("next dev -p 3001")).toBe(3001);
  });

  it("reads '--port=4000'", () => {
    expect(parsePortFlag("vite --port=4000")).toBe(4000);
  });

  it("returns null when there is no port flag", () => {
    expect(parsePortFlag("vite")).toBeNull();
  });

  it("returns null for an out-of-range port", () => {
    expect(parsePortFlag("vite --port 99999")).toBeNull();
  });

  it("does not mistake other flags for a port flag", () => {
    expect(parsePortFlag("node server.js --prod 8080")).toBeNull();
  });
});

describe("detectFromPackageJson", () => {
  it("detects Next.js as a single frontend on its default port", () => {
    const result = detectFromPackageJson({ dependencies: { next: "14.0.0" }, scripts: { dev: "next dev" } });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: "frontend", framework: "Next.js", port: 3000, portSource: "framework-default" });
  });

  it("prefers an explicit script port over the framework default", () => {
    const result = detectFromPackageJson({ devDependencies: { vite: "5.0.0" }, scripts: { dev: "vite --port 4000" } });

    expect(result[0]).toMatchObject({ framework: "Vite", port: 4000, portSource: "script-flag" });
  });

  it("detects Vite's default port when no flag is given", () => {
    const result = detectFromPackageJson({ devDependencies: { vite: "5.0.0" }, scripts: { dev: "vite" } });

    expect(result[0]).toMatchObject({ port: 5173, portSource: "framework-default" });
  });

  it("reports an unknown backend port when frontend and backend share one package", () => {
    const result = detectFromPackageJson({
      dependencies: { express: "4.0.0" },
      devDependencies: { vite: "5.0.0" },
      scripts: { dev: "vite --port 4000" },
    });

    const backend = result.find((s) => s.role === "backend");
    expect(backend).toMatchObject({ framework: "Express", port: null, portSource: "unknown" });
  });

  it("returns nothing for a package with no recognized framework", () => {
    expect(detectFromPackageJson({ dependencies: { lodash: "4.0.0" } })).toEqual([]);
  });

  it("prefers Next.js when both next and vite are present", () => {
    const result = detectFromPackageJson({ dependencies: { next: "14.0.0", vite: "5.0.0" } });

    expect(result.filter((s) => s.role === "frontend")).toHaveLength(1);
    expect(result[0].framework).toBe("Next.js");
  });
});