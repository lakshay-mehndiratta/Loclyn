"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";
import { ServiceStatusIcon, FrameworkIcon } from "@/components/Badges";

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
                  <ServiceStatusIcon status={service.status} />
                </td>
                <td>{service.name}</td>
                {service.framework && (
                  <td>
                    <span className="framework-badge">
                      <FrameworkIcon framework={service.framework} />
                      {service.framework}
                    </span>
                  </td>
                )}
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