"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";

export function ServicesPanel() {
  const { services } = useLoclynData();
  const list = Object.values(services);

  return (
    <section className="panel">
      <h2>Services</h2>
      {list.length === 0 ? (
        <p className="empty-state">No services reported yet.</p>
      ) : (
        <table>
          <tbody>
            {list.map((service) => (
              <tr key={service.name}>
                <td>
                  <span className={`status-dot ${service.status === "running" ? "status-ok" : "status-error"}`} />
                </td>
                <td>{service.name}</td>
                {service.framework && <td className="badge">{service.framework}</td>}
                <td>:{service.port}</td>
                <td>{service.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}