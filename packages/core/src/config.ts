import fs from "node:fs";
import path from "node:path";
import type { ServiceConfig, ServiceType, ValueSource } from "./types.js";

export const CONFIG_FILE_NAME = ".loclyn.json";
export const DEFAULT_PROXY_PORT = 4020;
export const DEFAULT_DASHBOARD_PORT = 4021;

export interface LoclynConfig {
  proxyPort?: number;
  dashboardPort?: number;
  services: ServiceConfig[];
}

/** Thrown for any problem with the config file. Carries every issue
 * found, so the user can fix them all in one go. */
export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid ${CONFIG_FILE_NAME}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const TOP_LEVEL_KEYS = ["proxyPort", "dashboardPort", "services"];
const SERVICE_KEYS = ["name", "type", "port", "pathPrefix", "framework"];
const SERVICE_TYPES: ServiceType[] = ["frontend", "backend"];

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses and validates the text of a .loclyn.json file.
 * Pure: no file access, so it is easy to unit-test. */
export function parseConfig(raw: string): LoclynConfig {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError([`not valid JSON (${(err as Error).message})`]);
  }

  const issues: string[] = [];

  if (!isPlainObject(data)) {
    throw new ConfigError(["the top level must be a JSON object, like { \"services\": [...] }"]);
  }

  for (const key of Object.keys(data)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      issues.push(`unknown key "${key}" (allowed: ${TOP_LEVEL_KEYS.join(", ")})`);
    }
  }

  const proxyPort = data.proxyPort;
  const dashboardPort = data.dashboardPort;
  if (proxyPort !== undefined && !isPort(proxyPort)) {
    issues.push("proxyPort must be an integer between 1 and 65535");
  }
  if (dashboardPort !== undefined && !isPort(dashboardPort)) {
    issues.push("dashboardPort must be an integer between 1 and 65535");
  }

  const effectiveProxy = isPort(proxyPort) ? proxyPort : DEFAULT_PROXY_PORT;
  const effectiveDashboard = isPort(dashboardPort) ? dashboardPort : DEFAULT_DASHBOARD_PORT;
  if (effectiveProxy === effectiveDashboard) {
    issues.push(`proxyPort and dashboardPort are both ${effectiveProxy}; they must differ`);
  }

  const services: ServiceConfig[] = [];
  const rawServices = data.services;

  if (!Array.isArray(rawServices) || rawServices.length === 0) {
    issues.push("services must be a non-empty array");
  } else {
    const seenNames = new Set<string>();
    let catchAllCount = 0;

    rawServices.forEach((entry, i) => {
      const where = `services[${i}]`;
      if (!isPlainObject(entry)) {
        issues.push(`${where} must be an object`);
        return;
      }

      for (const key of Object.keys(entry)) {
        if (!SERVICE_KEYS.includes(key)) {
          issues.push(`${where}: unknown key "${key}" (allowed: ${SERVICE_KEYS.join(", ")})`);
        }
      }

      const { name, type, port, pathPrefix, framework } = entry;

      if (typeof name !== "string" || name.trim() === "") {
        issues.push(`${where}.name must be a non-empty string`);
      } else if (seenNames.has(name)) {
        issues.push(`${where}.name "${name}" is used more than once`);
      } else {
        seenNames.add(name);
      }

      if (typeof type !== "string" || !SERVICE_TYPES.includes(type as ServiceType)) {
        issues.push(`${where}.type must be "frontend" or "backend"`);
      }

      if (!isPort(port)) {
        issues.push(`${where}.port must be an integer between 1 and 65535`);
      } else if (port === effectiveProxy || port === effectiveDashboard) {
        issues.push(`${where}.port ${port} is already used by Loclyn itself`);
      }

      let normalizedPrefix: string | undefined;
      if (pathPrefix !== undefined) {
        if (typeof pathPrefix !== "string" || !pathPrefix.startsWith("/") || pathPrefix === "/") {
          issues.push(
            `${where}.pathPrefix must start with "/" and name a path like "/api" ` +
              `(leave it out for the catch-all service)`,
          );
        } else {
          normalizedPrefix = pathPrefix.replace(/\/+$/, "");
        }
      } else {
        catchAllCount++;
      }

      if (framework !== undefined && typeof framework !== "string") {
        issues.push(`${where}.framework must be a string`);
      }

      if (
        typeof name === "string" &&
        SERVICE_TYPES.includes(type as ServiceType) &&
        isPort(port)
      ) {
        const service: ServiceConfig = { name, type: type as ServiceType, port };
        if (normalizedPrefix) service.pathPrefix = normalizedPrefix;
        if (typeof framework === "string") service.framework = framework;
        services.push(service);
      }
    });

    if (catchAllCount > 1) {
      issues.push(
        `${catchAllCount} services have no pathPrefix; only one service can be the catch-all`,
      );
    }
  }

  if (issues.length > 0) throw new ConfigError(issues);

  const config: LoclynConfig = { services };
  if (isPort(proxyPort)) config.proxyPort = proxyPort;
  if (isPort(dashboardPort)) config.dashboardPort = dashboardPort;
  return config;
}

/** Looks for .loclyn.json in `dir`. Returns null if the file doesn't
 * exist (that is normal — the config file is optional). Throws
 * ConfigError if it exists but is invalid. */
export function loadConfigFile(dir: string = process.cwd()): LoclynConfig | null {
  const filePath = path.join(dir, CONFIG_FILE_NAME);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return parseConfig(raw);
}

/** Picks a setting using the precedence flag > config file > default and
 * reports which source won. This is the single place that rule lives. */
export function resolveValue<T>(
  flag: T | undefined,
  file: T | undefined,
  fallback: T,
): { value: T; source: ValueSource } {
  if (flag !== undefined) return { value: flag, source: "flag" };
  if (file !== undefined) return { value: file, source: "config-file" };
  return { value: fallback, source: "default" };
}