import fs from "node:fs";
import path from "node:path";

export interface FindExecutableOptions {
  /** The PATH string to search. Defaults to process.env.PATH. */
  pathEnv?: string;
  /** Defaults to process.platform. Windows also tries the PATHEXT extensions. */
  platform?: NodeJS.Platform;
  /** Windows only: ";"-separated extensions. Defaults to process.env.PATHEXT. */
  pathExt?: string;
}

/**
 * Looks for a program on the PATH, the way a shell would, and returns its
 * full path — or null if it isn't there. Nothing is run; we only check that
 * a real, executable file exists. Used to tell the user up front that
 * `cloudflared` is missing, instead of failing later.
 *
 * Takes its inputs as options (rather than reading globals) so it can be
 * unit-tested for every platform on any machine.
 */
export function findExecutable(name: string, options: FindExecutableOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const dirs = pathEnv.split(windows ? ";" : ":").filter((d) => d !== "");

  // On Windows "cloudflared" means cloudflared.exe / .cmd / ...
  const extensions = windows
    ? ["", ...(options.pathExt ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)]
    : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (!windows) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // missing, a directory, or not executable — keep looking
      }
    }
  }
  return null;
}