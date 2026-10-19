"use client";

import { useEffect, useMemo, useState } from "react";
import { useLoclynData } from "@/lib/LoclynDataContext";
import { ScrollingText } from "@/components/ScrollingText";
import { ServiceCell } from "@/components/ServiceCell";
import type { WebSocketConnection, WebSocketStatus } from "@loclyn/core";

type StatusFilter = "all" | WebSocketStatus;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long the connection was (or has been) open. Failed connections
 * never opened, so there is no duration to show. */
function durationOf(conn: WebSocketConnection, now: number): string {
  if (conn.openedAt === null) return "—";
  const end = conn.status === "open" ? now : (conn.closedAt ?? now);
  return formatDuration(end - conn.openedAt);
}

function StateBadge({ status }: { status: WebSocketStatus }) {
  return <span className={`ws-badge ws-${status}`}>{status}</span>;
}

export default function WebSocketsPage() {
  const { websockets, services } = useLoclynData();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Re-render once a second so the duration of open connections keeps ticking.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const all = useMemo(
    () => Object.values(websockets).sort((a, b) => b.startedAt - a.startedAt),
    [websockets],
  );

  const counts = useMemo(() => {
    const result = { open: 0, closed: 0, failed: 0 };
    for (const c of all) {
      if (c.status === "open") result.open++;
      else if (c.status === "closed") result.closed++;
      else if (c.status === "failed") result.failed++;
    }
    return result;
  }, [all]);

  const filtered = all.filter((c) => statusFilter === "all" || c.status === statusFilter);

  return (
    <div>
      <section className="panel">
        <div className="panel-header-row">
          <h2>
            WebSockets ({counts.open} open · {counts.closed} closed · {counts.failed} failed)
          </h2>
          <div className="filters">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All states</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="failed">Failed</option>
              <option value="connecting">Connecting</option>
            </select>
          </div>
        </div>

        {all.length === 0 ? (
          <p className="empty-state">No WebSocket connections yet.</p>
        ) : filtered.length === 0 ? (
          <p className="empty-state">No connections match this filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Path</th>
                <th>Service</th>
                <th>State</th>
                <th>Duration</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="dim">{new Date(c.startedAt).toLocaleTimeString()}</td>
                  <td className="path-cell"><ScrollingText text={c.path} /></td>
                  <td>
                    <ServiceCell serviceName={c.serviceName} services={services} />
                  </td>
                  <td><StateBadge status={c.status} /></td>
                  <td className="dim">{durationOf(c, now)}</td>
                  <td className="dim">
                    {c.reason ? <ScrollingText text={c.reason} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>About this page</h2>
        <p className="about-text">
          Loclyn tracks each WebSocket&apos;s handshake and lifetime: whether the service accepted the
          upgrade, how long the connection stayed open, and why it failed if it didn&apos;t. It does
          not inspect individual messages, so there are no message counts here.
        </p>
      </section>
    </div>
  );
}