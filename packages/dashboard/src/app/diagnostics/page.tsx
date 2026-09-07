"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";

function severityDot(severity: string): string {
  if (severity === "ok") return "status-ok";
  if (severity === "warning") return "status-warning";
  return "status-error";
}

function confidenceLabel(confidence: string): string {
  return confidence === "high" ? "High confidence" : "Medium confidence";
}

export default function DiagnosticsPage() {
  const { diagnostics } = useLoclynData();
  const list = Object.values(diagnostics);

  return (
    <div>
      <section className="panel">
        <h2>All Diagnostics</h2>
        {list.length === 0 ? (
          <p className="empty-state">No diagnostics reported yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Check</th>
                <th>Target</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Confidence</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id + d.detail}>
                  <td>
                    <span className={`status-dot ${severityDot(d.severity)}`} />
                  </td>
                  <td>{d.label}</td>
                  <td className="dim">{d.detail}</td>
                  <td>{d.severity}</td>
                  <td>{d.message ?? "—"}</td>
                  <td className="dim">{confidenceLabel(d.confidence)}</td>
                  <td className="dim">{new Date(d.updatedAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>About confidence levels</h2>
        <p className="about-text">
          <strong>High confidence</strong> checks are based on something Loclyn directly observed —
          a TCP connection succeeding or failing, or a WebSocket upgrade being forwarded. <strong>Medium
          confidence</strong> checks are based on a pattern Loclyn inferred from recent traffic — for
          example, a burst of failed requests to a service. Medium-confidence diagnostics can have
          causes outside Loclyn itself, such as a bug in the target application.
        </p>
      </section>
    </div>
  );
}