"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";

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
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Type</th>
                <th>Framework</th>
                <th>Port</th>
                <th>Status</th>
                <th>Route</th>
                <th>Last checked</th>
              </tr>
            </thead>
            <tbody>
              {list.map((service) => (
                <tr key={service.name}>
                  <td>
                    <span
                      className={`status-dot ${service.status === "running" ? "status-ok" : "status-error"}`}
                    />
                  </td>
                  <td>{service.name}</td>
                  <td className="dim">{service.type}</td>
                  <td>{service.framework ? <span className="badge">{service.framework}</span> : "—"}</td>
                  <td>:{service.port}</td>
                  <td>{service.status}</td>
                  <td className="dim">{service.pathPrefix ?? "default (catch-all)"}</td>
                  <td className="dim">{formatLastChecked(service.lastCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}