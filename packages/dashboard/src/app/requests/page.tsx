"use client";

import { useMemo, useState } from "react";
import { useLoclynData } from "@/lib/LoclynDataContext";
import type { RequestLogEntry } from "@loclyn/core";

type StatusFilter = "all" | "2xx" | "4xx" | "5xx";

function statusClass(status: number): string {
  if (status >= 500) return "code-error";
  if (status >= 400) return "code-warning";
  return "code-ok";
}

function matchesStatusFilter(status: number, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "2xx") return status >= 200 && status < 300;
  if (filter === "4xx") return status >= 400 && status < 500;
  if (filter === "5xx") return status >= 500;
  return true;
}

export default function RequestsPage() {
  const { requests } = useLoclynData();

  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // All filter option lists are derived from the actual requests we've
  // seen, not hardcoded — so they only ever show values that have
  // genuinely appeared, never an option that would return zero results.
  const availableMethods = useMemo(
    () => Array.from(new Set(requests.map((r) => r.method))).sort(),
    [requests],
  );
  const availableServices = useMemo(
    () => Array.from(new Set(requests.map((r) => r.serviceName))).sort(),
    [requests],
  );
  const availableTypes = useMemo(
    () => Array.from(new Set(requests.map((r) => r.type))).sort(),
    [requests],
  );

  const filtered = useMemo<RequestLogEntry[]>(() => {
    return requests.filter((r) => {
      if (methodFilter !== "all" && r.method !== methodFilter) return false;
      if (serviceFilter !== "all" && r.serviceName !== serviceFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (!matchesStatusFilter(r.status, statusFilter)) return false;
      return true;
    });
  }, [requests, methodFilter, statusFilter, serviceFilter, typeFilter]);

  return (
    <div>
      <section className="panel">
        <div className="panel-header-row">
          <h2>All Requests ({filtered.length} of {requests.length})</h2>
          <div className="filters">
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="all">All methods</option>
              {availableMethods.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              {availableTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="all">All statuses</option>
              <option value="2xx">2xx success</option>
              <option value="4xx">4xx client error</option>
              <option value="5xx">5xx server error</option>
            </select>

            <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
              <option value="all">All services</option>
              {availableServices.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {requests.length === 0 ? (
          <p className="empty-state">No requests yet.</p>
        ) : filtered.length === 0 ? (
          <p className="empty-state">No requests match the current filters.</p>
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
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="dim">{new Date(r.time).toLocaleTimeString()}</td>
                  <td><span className="badge">{r.method}</span></td>
                  <td className="path-cell" title={r.path}>{r.path}</td>
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
    </div>
  );
}