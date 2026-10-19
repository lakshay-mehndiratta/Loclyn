import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { LoclynEventBus, type LoclynEvent, type WebSocketConnection } from "@loclyn/core";
import { DashboardServer } from "./dashboard-server.js";

describe("DashboardServer snapshot", () => {
  it("replays known WebSocket connections to a client that connects late", async () => {
    const bus = new LoclynEventBus();
    const server = new DashboardServer(bus);
    await server.listen(45134);

    const conn: WebSocketConnection = {
      id: "ws-1",
      serviceName: "frontend",
      path: "/hmr",
      status: "open",
      startedAt: Date.now(),
      openedAt: Date.now(),
      closedAt: null,
    };
    bus.emit({ type: "websocket:updated", payload: conn });

    const received: LoclynEvent[] = [];
    const client = new WebSocket("ws://127.0.0.1:45134/ws");
    client.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => client.on("open", () => resolve()));
    await new Promise((r) => setTimeout(r, 100));

    client.close();
    await server.close();

    const replayed = received.find((e) => e.type === "websocket:updated");
    expect(replayed).toBeDefined();
    expect((replayed as { payload: WebSocketConnection }).payload.id).toBe("ws-1");
  });

  it("keeps only the latest state per connection", async () => {
    const bus = new LoclynEventBus();
    const server = new DashboardServer(bus);
    await server.listen(45135);

    const base: WebSocketConnection = {
      id: "ws-2",
      serviceName: "frontend",
      path: "/hmr",
      status: "open",
      startedAt: 1,
      openedAt: 1,
      closedAt: null,
    };
    bus.emit({ type: "websocket:updated", payload: base });
    bus.emit({ type: "websocket:updated", payload: { ...base, status: "closed", closedAt: 2 } });

    const received: LoclynEvent[] = [];
    const client = new WebSocket("ws://127.0.0.1:45135/ws");
    client.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => client.on("open", () => resolve()));
    await new Promise((r) => setTimeout(r, 100));

    client.close();
    await server.close();

    const replays = received.filter((e) => e.type === "websocket:updated");
    expect(replays).toHaveLength(1);
    expect((replays[0] as { payload: WebSocketConnection }).payload.status).toBe("closed");
  });
});