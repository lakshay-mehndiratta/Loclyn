import { spawn, type ChildProcess } from "node:child_process";
import { LoclynEventBus } from "./event-bus.js";
import type { ConnectionState, DiagnosticResult, DiagnosticSeverity } from "./types.js";

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** Tells the user how to install cloudflared on their OS. Pure function
 * (takes the platform as an argument) so it can be unit-tested. */
export function cloudflaredInstallHint(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case "darwin":
      return "Install it with: brew install cloudflared";
    case "win32":
      return "Install it with: winget install --id Cloudflare.cloudflared (then open a new terminal)";
    default:
      return "Install it from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";
  }
}

/**
 * TunnelManager spawns `cloudflared tunnel --url http://127.0.0.1:PORT`
 * (a "quick tunnel" — no Cloudflare account needed) and reports its
 * lifecycle as connection:updated events, plus a `tunnel-availability`
 * diagnostic so the dashboard can explain *why* there is no tunnel.
 */
export class TunnelManager {
  private process: ChildProcess | null = null;
  private stopping = false;
  private state: ConnectionState = {
    tunnel: "connecting",
    proxy: "starting",
    ssl: "inactive",
    deviceUrl: null,
    startedAt: null,
  };

  constructor(
    private bus: LoclynEventBus,
    private binary: string = "cloudflared",
  ) {}

  reportProxyRunning(): void {
    this.updateState({ proxy: "running" });
  }

  start(localPort: number): void {
    this.process = spawn(this.binary, ["tunnel", "--url", `http://127.0.0.1:${localPort}`]);

    this.process.stderr?.on("data", (chunk: Buffer) => this.handleOutput(chunk.toString()));
    this.process.stdout?.on("data", (chunk: Buffer) => this.handleOutput(chunk.toString()));

    this.process.on("error", (err: NodeJS.ErrnoException) => {
      this.updateState({ tunnel: "disconnected" });

      if (err.code === "ENOENT") {
        // Node could not find the binary on PATH — it isn't installed.
        // We observed this directly, so confidence is "high".
        const hint = cloudflaredInstallHint();
        console.error(`[tunnel] "${this.binary}" was not found. ${hint}`);
        this.emitDiagnostic(
          "error",
          `"${this.binary}" is not installed or not on your PATH. ${hint}`,
        );
        return;
      }

      console.error(`[tunnel] failed to start ${this.binary}: ${err.message}`);
      this.emitDiagnostic("error", `Could not start ${this.binary}: ${err.message}`);
    });

    this.process.on("exit", (code) => {
      this.updateState({ tunnel: "disconnected", deviceUrl: null });
      if (!this.stopping && code !== 0 && code !== null) {
        console.error(`[tunnel] ${this.binary} exited unexpectedly (code ${code})`);
        this.emitDiagnostic("error", `${this.binary} exited unexpectedly (code ${code}).`);
      }
    });
  }

  private handleOutput(text: string): void {
    if (this.state.tunnel !== "connected") {
      const match = text.match(TUNNEL_URL_PATTERN);
      if (match) {
        this.updateState({
          tunnel: "connected",
          ssl: "active",
          deviceUrl: match[0],
          startedAt: Date.now(),
        });
        this.emitDiagnostic("ok", "Tunnel is up and reachable.");
      }
    }
  }

  private emitDiagnostic(severity: DiagnosticSeverity, message: string): void {
    const result: DiagnosticResult = {
      id: "tunnel-availability",
      label: "Tunnel",
      detail: this.binary,
      severity,
      confidence: "high",
      message,
      updatedAt: Date.now(),
    };
    this.bus.emit({ type: "diagnostic:updated", payload: result });
  }

  private updateState(partial: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...partial };
    this.bus.emit({ type: "connection:updated", payload: this.state });
  }

  stop(): void {
    this.stopping = true;
    this.process?.kill();
    this.process = null;
    this.updateState({ tunnel: "disconnected", proxy: "stopped", deviceUrl: null });
  }
}