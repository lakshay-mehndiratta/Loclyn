import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export type DetectedRole = "frontend" | "backend";

export interface DetectedService {
  role: DetectedRole;
  framework: string;
  /** null means "we know the framework but cannot know its port" */
  port: number | null;
  portSource: "script-flag" | "framework-default" | "unknown";
  /** Which folder this was found in, relative to the scanned root ("." = root) */
  source: string;
}

export interface DetectionResult {
  services: DetectedService[];
  /** Human-readable ambiguities the caller should surface or ask about */
  notes: string[];
}

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

// Order matters: the first matching rule wins within each role.
const FRONTEND_RULES = [
  { dep: "next", framework: "Next.js", defaultPort: 3000 },
  { dep: "vite", framework: "Vite", defaultPort: 5173 },
  { dep: "react-scripts", framework: "Create React App", defaultPort: 3000 },
];

const BACKEND_RULES = [
  { dep: "express", framework: "Express" },
  { dep: "fastify", framework: "Fastify" },
  { dep: "koa", framework: "Koa" },
  { dep: "@nestjs/core", framework: "NestJS" },
];

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

/** Extracts a port from a script like "next dev -p 3001" or "vite --port=4000". */
export function parsePortFlag(script: string): number | null {
  const match = script.match(/(?:^|\s)(?:--port|-p)(?:=|\s+)(\d{2,5})(?=\s|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Pure: decides what a single package.json describes. No file access. */
export function detectFromPackageJson(pkg: PackageJsonLike, source = "."): DetectedService[] {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const devScript = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";
  const flagPort = parsePortFlag(devScript);
  const results: DetectedService[] = [];

  const frontend = FRONTEND_RULES.find((rule) => rule.dep in deps);
  if (frontend) {
    results.push({
      role: "frontend",
      framework: frontend.framework,
      port: flagPort ?? frontend.defaultPort,
      portSource: flagPort ? "script-flag" : "framework-default",
      source,
    });
  }

  const backend = BACKEND_RULES.find((rule) => rule.dep in deps);
  if (backend) {
    // If a frontend was also found in this same package, the dev script's
    // port flag most likely belongs to the frontend — so the backend's
    // port is genuinely unknown, not something to guess at.
    const port = frontend ? null : flagPort;
    results.push({
      role: "backend",
      framework: backend.framework,
      port,
      portSource: port ? "script-flag" : "unknown",
      source,
    });
  }

  return results;
}

async function readPackageJson(dir: string): Promise<PackageJsonLike | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null; // missing or unparseable — simply nothing to detect here
  }
}

/** Scans `dir` and its immediate subfolders (e.g. client/, server/). */
export async function detectProject(dir: string): Promise<DetectionResult> {
  const candidates = [{ dir, label: "." }];

  const entries: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
      candidates.push({ dir: path.join(dir, entry.name), label: entry.name });
    }
  }

  const services: DetectedService[] = [];
  for (const candidate of candidates) {
    const pkg = await readPackageJson(candidate.dir);
    if (pkg) services.push(...detectFromPackageJson(pkg, candidate.label));
  }

  const notes: string[] = [];
  const frontends = services.filter((s) => s.role === "frontend");
  const backends = services.filter((s) => s.role === "backend");

  if (frontends.length > 1) {
    notes.push(
      `Multiple frontend candidates found (${frontends.map((f) => `${f.framework} in ${f.source}`).join(", ")}). Specify which one with --frontend.`,
    );
  }
  if (backends.length > 1) {
    notes.push(
      `Multiple backend candidates found (${backends.map((b) => `${b.framework} in ${b.source}`).join(", ")}). Specify which one with --backend.`,
    );
  }
  if (backends.some((b) => b.port === null)) {
    notes.push("A backend framework was found, but its port can't be detected from package.json — pass it with --backend.");
  }

  return { services, notes };
}