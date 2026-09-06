"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LoclynEvent,
  ServiceState,
  DiagnosticResult,
  ConnectionState,
  RequestLogEntry,
} from "@loclyn/core";

const DASHBOARD_SERVER_PORT = 4021;
const MAX_REQUESTS = 20;

export interface LoclynData {
  wsConnected: boolean;
  connection: ConnectionState | null;
  services: Record<string, ServiceState>;
  diagnostics: Record<string, DiagnosticResult>;
  requests: RequestLogEntry[];
}

const initialData: LoclynData = {
  wsConnected: false,
  connection: null,
  services: {},
  diagnostics: {},
  requests: [],
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
      const ws = new WebSocket(`ws://localhost:${DASHBOARD_SERVER_PORT}/ws`);
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