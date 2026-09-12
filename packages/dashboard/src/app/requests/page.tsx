"use client";

import { useEffect, useMemo, useState } from "react";
import { useLoclynData } from "@/lib/LoclynDataContext";
import type { RequestLogEntry } from "@loclyn/core";

type StatusFilter = "all" | "2xx" | "4xx" | "5xx";

const PAGE_SIZE = 50;

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
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // If a filter change (or new live traffic shrinking the filtered set)
  // leaves the current page out of range, snap back to a valid page
  // instead of showing a blank page with working-looking controls.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function handleFilterChange<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1); // any filter change should reset to page 1, not strand you on an empty later page
  }

  return (
    <div>
      <section className="panel">
        <div className="panel-header-row">
          <h2>All Requests ({filtered.length} of {requests.length})</h2>
          <div className="filters">
            <select
              value={methodFilter}
              onChange={(e) => handleFilterChange(setMethodFilter, e.target.value)}
            >
              <option value="all">All methods</option>
              {availableMethods.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => handleFilterChange(setTypeFilter, e.target.value)}
            >
              <option value="all">All types</option>
              {availableTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => handleFilterChange(setStatusFilter, e.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="2xx">2xx success</option>
              <option value="4xx">4xx client error</option>
              <option value="5xx">5xx server error</option>
            </select>

            <select
              value={serviceFilter}
              onChange={(e) => handleFilterChange(setServiceFilter, e.target.value)}
            >
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
          <>
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
                {pageItems.map((r) => (
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

            <div className="pagination">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="pagination-status">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}