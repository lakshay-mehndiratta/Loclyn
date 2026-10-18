import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfig, loadConfigFile, ConfigError, CONFIG_FILE_NAME } from "./config.js";

function issuesOf(raw: string): string[] {
  try {
    parseConfig(raw);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  return [];
}

describe("parseConfig — valid input", () => {
  it("accepts three services and custom ports", () => {
    const config = parseConfig(
      JSON.stringify({
        proxyPort: 5000,
        dashboardPort: 5001,
        services: [
          { name: "web", type: "frontend", port: 5173, framework: "Vite" },
          { name: "api", type: "backend", port: 3000, pathPrefix: "/api" },
          { name: "auth", type: "backend", port: 4000, pathPrefix: "/auth" },
        ],
      }),
    );
    expect(config.proxyPort).toBe(5000);
    expect(config.dashboardPort).toBe(5001);
    expect(config.services).toHaveLength(3);
    expect(config.services[0]).toEqual({
      name: "web",
      type: "frontend",
      port: 5173,
      framework: "Vite",
    });
  });

  it("leaves ports undefined when not given", () => {
    const config = parseConfig(
      JSON.stringify({ services: [{ name: "web", type: "frontend", port: 3000 }] }),
    );
    expect(config.proxyPort).toBeUndefined();
    expect(config.dashboardPort).toBeUndefined();
  });

  it("strips a trailing slash from pathPrefix", () => {
    const config = parseConfig(
      JSON.stringify({
        services: [
          { name: "web", type: "frontend", port: 3000 },
          { name: "api", type: "backend", port: 4000, pathPrefix: "/api/" },
        ],
      }),
    );
    expect(config.services[1].pathPrefix).toBe("/api");
  });
});

describe("parseConfig — invalid input", () => {
  it("rejects invalid JSON", () => {
    expect(issuesOf("{ nope")[0]).toContain("not valid JSON");
  });

  it("rejects a non-object top level", () => {
    expect(issuesOf("[]")[0]).toContain("JSON object");
  });

  it("rejects missing or empty services", () => {
    expect(issuesOf("{}")).toContain("services must be a non-empty array");
    expect(issuesOf('{"services": []}')).toContain("services must be a non-empty array");
  });

  it("rejects unknown keys (catches typos)", () => {
    const issues = issuesOf(
      JSON.stringify({
        servces: [],
        services: [{ name: "a", type: "frontend", port: 3000, pathPrefx: "/x" }],
      }),
    );
    expect(issues.some((i) => i.includes('unknown key "servces"'))).toBe(true);
    expect(issues.some((i) => i.includes('unknown key "pathPrefx"'))).toBe(true);
  });

  it("rejects bad ports, types and prefixes, reporting all at once", () => {
    const issues = issuesOf(
      JSON.stringify({
        services: [
          { name: "a", type: "database", port: "3000" },
          { name: "b", type: "backend", port: 70000, pathPrefix: "api" },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("services[0].type"))).toBe(true);
    expect(issues.some((i) => i.includes("services[0].port"))).toBe(true);
    expect(issues.some((i) => i.includes("services[1].port"))).toBe(true);
    expect(issues.some((i) => i.includes("services[1].pathPrefix"))).toBe(true);
  });

  it("rejects duplicate names", () => {
    const issues = issuesOf(
      JSON.stringify({
        services: [
          { name: "a", type: "frontend", port: 3000 },
          { name: "a", type: "backend", port: 4000, pathPrefix: "/api" },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("used more than once"))).toBe(true);
  });

  it("rejects two catch-all services", () => {
    const issues = issuesOf(
      JSON.stringify({
        services: [
          { name: "a", type: "frontend", port: 3000 },
          { name: "b", type: "backend", port: 4000 },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("only one service can be the catch-all"))).toBe(true);
  });

  it("rejects a service port that collides with Loclyn's own ports", () => {
    const issues = issuesOf(
      JSON.stringify({ services: [{ name: "a", type: "frontend", port: 4020 }] }),
    );
    expect(issues.some((i) => i.includes("already used by Loclyn"))).toBe(true);
  });

  it("rejects proxyPort equal to dashboardPort", () => {
    const issues = issuesOf(
      JSON.stringify({
        proxyPort: 5000,
        dashboardPort: 5000,
        services: [{ name: "a", type: "frontend", port: 3000 }],
      }),
    );
    expect(issues.some((i) => i.includes("must differ"))).toBe(true);
  });
});

describe("loadConfigFile", () => {
  it("returns null when the file doesn't exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loclyn-cfg-"));
    expect(loadConfigFile(dir)).toBeNull();
  });

  it("loads a valid file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loclyn-cfg-"));
    fs.writeFileSync(
      path.join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ services: [{ name: "web", type: "frontend", port: 3000 }] }),
    );
    expect(loadConfigFile(dir)?.services[0].name).toBe("web");
  });

  it("throws ConfigError for an invalid file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loclyn-cfg-"));
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), "{ broken");
    expect(() => loadConfigFile(dir)).toThrow(ConfigError);
  });
});