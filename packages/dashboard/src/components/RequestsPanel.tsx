"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";
import { ScrollingText } from "@/components/ScrollingText";
import { MethodBadge, StatusBadge } from "@/components/Badges";
import { ServiceCell } from "@/components/ServiceCell";

const OVERVIEW_REQUEST_LIMIT = 10;

function formatSize(bytes: number | null): string {
  if (bytes === null) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function RequestsPanel() {
  const { requests, services } = useLoclynData();
  const recent = requests.slice(0, OVERVIEW_REQUEST_LIMIT);

  return (
    <section className="panel panel-wide">
      <h2>Recent Requests</h2>
      {recent.length === 0 ? (
        <p className="empty-state">No requests yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>Path</th>
              <th>Status</th>
              <th>Service</th>
              <th>Type</th>
              <th>Size</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id}>
                <td className="dim">{new Date(r.time).toLocaleTimeString()}</td>
                <td>
                  <MethodBadge method={r.method} />
                </td>
                <td className="path-cell"><ScrollingText text={r.path} /></td>
                <td><StatusBadge status={r.status} /></td>
                <td>
                  <ServiceCell serviceName={r.serviceName} services={services} />
                </td>
                <td className="dim">{r.type}</td>
                <td className="dim">{formatSize(r.sizeBytes)}</td>
                <td className="dim">{r.durationMs === null ? "—" : `${r.durationMs}ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}