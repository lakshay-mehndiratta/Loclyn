"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";
import { DiagnosticTypeIcon, SeverityBadge } from "@/components/Badges";
import { ScrollingText } from "@/components/ScrollingText";

export function DiagnosticsPanel() {
  const { diagnostics } = useLoclynData();
  const list = Object.values(diagnostics);

  return (
    <section className="panel">
      <h2>Diagnostics</h2>
      {list.length === 0 ? (
        <p className="empty-state">No diagnostics reported yet.</p>
      ) : (
        <table>
          <tbody>
            {list.map((d) => (
              <tr key={d.id + d.detail}>
                <td className="col-diagnostic-label">
                  <span className="diagnostic-label-cell">
                    <DiagnosticTypeIcon id={d.id} />
                    {d.label}
                  </span>
                </td>
                <td className="dim col-diagnostic-detail"><ScrollingText text={d.detail} /></td>
                <td>{d.message ?? ""}</td>
                <td>
                  <SeverityBadge severity={d.severity} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}