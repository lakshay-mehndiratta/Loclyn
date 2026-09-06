"use client";

import { useEffect, useState } from "react";
import { useLoclynData } from "@/lib/LoclynDataContext";

function formatUptime(startedAt: number | null): string {
  if (!startedAt) return "—";
  const totalSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function StatusField({ label, value, isOk }: { label: string; value: string; isOk: boolean }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">
        <span className={`status-dot ${isOk ? "status-ok" : "status-error"}`} />
        {value}
      </span>
    </div>
  );
}

export function ConnectionPanel() {
  const { connection } = useLoclynData();
  // Local re-render tick so uptime keeps counting between real events —
  // the underlying startedAt timestamp is still real data from the bus.
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const tunnel = connection?.tunnel ?? "connecting";
  const proxy = connection?.proxy ?? "starting";
  const ssl = connection?.ssl ?? "inactive";
  const deviceUrl = connection?.deviceUrl ?? null;

  return (
    <section className="panel panel-wide">
      <h2>Connection</h2>
      <div className="connection-summary">
        <div className="device-url-block">
          <span className="field-label">Device URL</span>
          {deviceUrl ? (
            <a href={deviceUrl} target="_blank" rel="noreferrer" className="device-url">
              {deviceUrl}
            </a>
          ) : (
            <span className="device-url device-url-empty">Not connected</span>
          )}
        </div>
        <div className="connection-fields">
          <StatusField label="Tunnel" value={tunnel} isOk={tunnel === "connected"} />
          <StatusField label="Proxy" value={proxy} isOk={proxy === "running"} />
          <StatusField label="SSL" value={ssl} isOk={ssl === "active"} />
          <div className="field">
            <span className="field-label">Uptime</span>
            <span className="field-value">{formatUptime(connection?.startedAt ?? null)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}