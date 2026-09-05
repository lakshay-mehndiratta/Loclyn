import { spawn, type ChildProcess } from "node:child_process";
import { LoclynEventBus } from "./event-bus.js";
import type { ConnectionState } from "./types.js";

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/**
 * TunnelManager spawns `cloudflared tunnel --url http://localhost:PORT`
 * (a "quick tunnel" — no Cloudflare account needed, generates a random
 * public URL for as long as the process runs) and reports its lifecycle
 * as connection:updated events on the shared bus.
 *
 * Unlike DiagnosticsEngine/DashboardServer, this is a PRODUCER, not a
 * subscriber — it doesn't react to bus events, it creates connection
 * state from scratch by watching a child process. It still follows the
 * same "one seam, no ripple effects" rule: proxy.ts, router.ts,
 * service-registry.ts, and diagnostics.ts are completely untouched.
 */
export class TunnelManager {
  private process: ChildProcess | null = null;
  private state: ConnectionState = {
    tunnel: "connecting",
    proxy: "starting",
    ssl: "inactive",
    deviceUrl: null,
    startedAt: null,
  };

  constructor(private bus: LoclynEventBus) {}

  /** Marks the proxy itself as running — called by the CLI once
   * LoclynProxy.listen() resolves. Kept separate from tunnel startup
   * since the two are genuinely independent processes with independent
   * failure modes. */
  reportProxyRunning(): void {
    this.updateState({ proxy: "running" });
  }

  start(localPort: number): void {
    this.process = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${localPort}`]);
    
    // cloudflared writes its logs (including the generated URL) to
    // stderr, not stdout — this is a real quirk of the tool, not a
    // mistake in our code.
    this.process.stderr?.on("data", (chunk: Buffer) => this.handleOutput(chunk.toString()));
    this.process.stdout?.on("data", (chunk: Buffer) => this.handleOutput(chunk.toString()));

    this.process.on("error", (err) => {
      // Fires if the `cloudflared` binary itself couldn't be found/started
      // — most commonly because it isn't installed.
      console.error(`[tunnel] failed to start cloudflared: ${err.message}`);
      this.updateState({ tunnel: "disconnected" });
    });

    this.process.on("exit", (code) => {
      this.updateState({ tunnel: "disconnected", deviceUrl: null });
      if (code !== 0 && code !== null) {
        console.error(`[tunnel] cloudflared exited unexpectedly (code ${code})`);
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
      }
    }
  }

  private updateState(partial: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...partial };
    this.bus.emit({ type: "connection:updated", payload: this.state });
  }

  stop(): void {
    this.process?.kill();
    this.process = null;
    this.updateState({ tunnel: "disconnected", proxy: "stopped", deviceUrl: null });
  }
}