"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";
import { ServiceStatusIcon, FrameworkIcon } from "@/components/Badges";

function formatLastChecked(timestamp: number): string {
  const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);
  if (secondsAgo < 5) return "just now";
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  const minutesAgo = Math.floor(secondsAgo / 60);
  return `${minutesAgo}m ago`;
}

export default function ServicesPage() {
  const { services } = useLoclynData();
  const list = Object.values(services);

  return (
    <div>
      <section className="panel">
        <h2>All Services</h2>
        {list.length === 0 ? (
          <p className="empty-state">No services reported yet.</p>
        ) : (
          <table className="stack-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Type</th>
                <th>Framework</th>
                <th>Port</th>
                <th>Status</th>
                <th>Route</th>
                <th>Status since</th>
              </tr>
            </thead>
            <tbody>
              {list.map((service) => (
                <tr key={service.name}>
                  <td data-corner>
                    <ServiceStatusIcon status={service.status} />
                  </td>
                  <td data-title>{service.name}</td>
                  <td className="dim" data-label="Type">{service.type}</td>
                  <td data-label="Framework">
                    {service.framework ? (
                      <span className="framework-badge">
                        <FrameworkIcon framework={service.framework} />
                        {service.framework}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Port">:{service.port}</td>
                  <td data-label="Status">{service.status}</td>
                  <td className="dim" data-label="Route">{service.pathPrefix ?? "default (catch-all)"}</td>
                  <td className="dim" data-label="Status since">{formatLastChecked(service.lastCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}