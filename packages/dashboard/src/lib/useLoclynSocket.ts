"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LoclynEvent,
  ServiceState,
  DiagnosticResult,
  ConnectionState,
  RequestLogEntry,
  WebSocketConnection,
  LogEntry,
  LoclynSettings,
} from "@loclyn/core";

const MAX_REQUESTS = 200;
const MAX_WEBSOCKETS = 100;
const MAX_LOGS = 300;

export interface LoclynData {
  wsConnected: boolean;
  connection: ConnectionState | null;
  services: Record<string, ServiceState>;
  diagnostics: Record<string, DiagnosticResult>;
  requests: RequestLogEntry[];
  websockets: Record<string, WebSocketConnection>;
  logs: LogEntry[];
  settings: LoclynSettings | null;
}

const initialData: LoclynData = {
  wsConnected: false,
  connection: null,
  services: {},
  diagnostics: {},
  requests: [],
  websockets: {},
  logs: [],
  settings: null,
};

/**
 * Connects to dashboard-server's WebSocket API and keeps a live copy of
 * Loclyn's real state in React state. This is the browser-side mirror of
 * dashboard-server's own in-memory snapshot — same reasoning: services/
 * diagnostics/connection are "latest known state" (keyed, overwritten in
 * place), while requests are a capped, most-recent-first log.
 */
export function useLoclynSocket(): LoclynData {
  const [data, setData] = useState<LoclynData>(initialData);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      const ws = new WebSocket(process.env.NEXT_PUBLIC_LOCLYN_WS_URL ?? "ws://localhost:4021/ws");
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setData((prev) => ({ ...prev, wsConnected: true }));
      };

      ws.onclose = () => {
        if (cancelled) return;
        setData((prev) => ({ ...prev, wsConnected: false }));
        setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        if (cancelled) return;
        const loclynEvent: LoclynEvent = JSON.parse(event.data);
        applyEvent(loclynEvent);
      };
    }

    function applyEvent(event: LoclynEvent) {
      setData((prev) => {
        if (event.type === "connection:updated") {
          return { ...prev, connection: event.payload };
        }
        if (event.type === "service:updated") {
          return {
            ...prev,
            services: { ...prev.services, [event.payload.name]: event.payload },
          };
        }
        if (event.type === "diagnostic:updated") {
          const key = event.payload.id + event.payload.detail;
          return {
            ...prev,
            diagnostics: { ...prev.diagnostics, [key]: event.payload },
          };
        }
        if (event.type === "request:logged") {
          const requests = [event.payload, ...prev.requests].slice(0, MAX_REQUESTS);
          return { ...prev, requests };
        }
        if (event.type === "settings:updated") {
          return { ...prev, settings: event.payload };
        }
        if (event.type === "log:entry") {
          const logs = [event.payload, ...prev.logs].slice(0, MAX_LOGS);
          return { ...prev, logs };
        }
        if (event.type === "websocket:updated") {
          const websockets = { ...prev.websockets, [event.payload.id]: event.payload };
          const ids = Object.keys(websockets);
          if (ids.length > MAX_WEBSOCKETS) {
            const oldest = ids.sort((a, b) => websockets[a].startedAt - websockets[b].startedAt)[0];
            delete websockets[oldest];
          }
          return { ...prev, websockets };
        }
        return prev;
      });
    }

    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, []);

  return data;
}