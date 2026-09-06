"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";

function statusClass(status: number): string {
  if (status >= 500) return "code-error";
  if (status >= 400) return "code-warning";
  return "code-ok";
}

export function RequestsPanel() {
  const { requests } = useLoclynData();

  return (
    <section className="panel panel-wide">
      <h2>Recent Requests</h2>
      {requests.length === 0 ? (
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
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="dim">{new Date(r.time).toLocaleTimeString()}</td>
                <td>
                  <span className="badge">{r.method}</span>
                </td>
                <td>{r.path}</td>
                <td className={statusClass(r.status)}>{r.status}</td>
                <td>{r.serviceName}</td>
                <td className="dim">{r.type}</td>
                <td className="dim">{r.durationMs === null ? "—" : `${r.durationMs}ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}