"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";
import { ScrollingText } from "@/components/ScrollingText";
import { DiagnosticTypeIcon, SeverityBadge } from "@/components/Badges";

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
                <th>Check</th>
                <th>Target</th>
                <th>Detail</th>
                <th>Confidence</th>
                <th>Last updated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id + d.detail}>
                  <td className="col-diagnostic-label">
                    <span className="diagnostic-label-cell">
                      <DiagnosticTypeIcon id={d.id} />
                      {d.label}
                    </span>
                  </td>
                  <td className="dim"><ScrollingText text={d.detail} /></td>
                  <td>{d.message ? <ScrollingText text={d.message} /> : "—"}</td>
                  <td className="dim">{confidenceLabel(d.confidence)}</td>
                  <td className="dim">{new Date(d.updatedAt).toLocaleTimeString()}</td>
                  <td>
                    <SeverityBadge severity={d.severity} />
                  </td>
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