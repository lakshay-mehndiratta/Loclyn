import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findExecutable } from "./executable.js";

describe("findExecutable", () => {
  let dirA = "";
  let dirB = "";

  beforeEach(() => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), "loclyn-bin-a-"));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), "loclyn-bin-b-"));
  });
  afterEach(() => {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  const make = (dir: string, file: string, mode: number) => {
    const full = path.join(dir, file);
    fs.writeFileSync(full, "#!/bin/sh\n");
    fs.chmodSync(full, mode);
    return full;
  };

  it("finds an executable file on the PATH", () => {
    const bin = make(dirB, "cloudflared", 0o755);
    expect(findExecutable("cloudflared", { pathEnv: `${dirA}:${dirB}`, platform: "linux" })).toBe(bin);
  });

  it("returns the first match when several directories have it", () => {
    const first = make(dirA, "cloudflared", 0o755);
    make(dirB, "cloudflared", 0o755);
    expect(findExecutable("cloudflared", { pathEnv: `${dirA}:${dirB}`, platform: "linux" })).toBe(first);
  });

  it("returns null when the program is not on the PATH", () => {
    expect(findExecutable("cloudflared", { pathEnv: `${dirA}:${dirB}`, platform: "linux" })).toBeNull();
  });

  it("returns null for an empty PATH", () => {
    expect(findExecutable("cloudflared", { pathEnv: "", platform: "linux" })).toBeNull();
  });

  it("ignores a file that is not executable", () => {
    make(dirA, "cloudflared", 0o644);
    // (root can execute anything it can read, so skip the assertion there)
    if (process.getuid?.() !== 0) {
      expect(findExecutable("cloudflared", { pathEnv: dirA, platform: "linux" })).toBeNull();
    }
  });

  it("ignores a directory with the same name", () => {
    fs.mkdirSync(path.join(dirA, "cloudflared"));
    expect(findExecutable("cloudflared", { pathEnv: dirA, platform: "linux" })).toBeNull();
  });

  it("on Windows, finds the program through the PATHEXT extensions", () => {
    // Real Windows file systems ignore case; this test runs on case-sensitive
    // ones too, so the extension list uses the same case as the file.
    const exe = make(dirA, "cloudflared.exe", 0o644);
    expect(
      findExecutable("cloudflared", { pathEnv: dirA, platform: "win32", pathExt: ".com;.exe;.cmd" }),
    ).toBe(exe);
  });

  it("on Windows, returns null when no extension matches", () => {
    make(dirA, "cloudflared.txt", 0o644);
    expect(findExecutable("cloudflared", { pathEnv: dirA, platform: "win32", pathExt: ".exe;.cmd" })).toBeNull();
  });
});