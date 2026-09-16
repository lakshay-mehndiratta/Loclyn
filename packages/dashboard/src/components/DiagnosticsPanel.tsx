"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";
import { SeverityIcon } from "@/components/Badges";

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
                <td>
                  <SeverityIcon severity={d.severity} />
                </td>
                <td>{d.label}</td>
                <td className="dim">{d.detail}</td>
                <td>{d.message ?? d.severity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}