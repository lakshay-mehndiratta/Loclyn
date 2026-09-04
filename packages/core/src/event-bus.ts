import { EventEmitter } from "node:events";
import type { LoclynEvent } from "./types.js";

type Listener = (event: LoclynEvent) => void;

/**
 * Single event bus for the whole engine. Every subsystem (proxy, service
 * monitor, diagnostics) emits through this instead of calling into a
 * renderer directly — that's what lets the CLI table and the dashboard
 * both exist as thin subscribers instead of the diagnostics engine having
 * to know two different rendering targets.
 */
export class LoclynEventBus {
  private emitter = new EventEmitter();
  private static readonly CHANNEL = "loclyn-event";

  constructor() {
    // Diagnostics/service updates can be frequent; avoid Node's default
    // warning noise for a legitimately multi-subscriber bus (CLI + dashboard + logger).
    this.emitter.setMaxListeners(50);
  }

  emit(event: LoclynEvent): void {
    this.emitter.emit(LoclynEventBus.CHANNEL, event);
  }

  on(listener: Listener): () => void {
    this.emitter.on(LoclynEventBus.CHANNEL, listener);
    return () => this.emitter.off(LoclynEventBus.CHANNEL, listener);
  }
}