"use client";

import { useEffect, useMemo, useState } from "react";
import { useLoclynData } from "@/lib/LoclynDataContext";
import { ScrollingText } from "@/components/ScrollingText";
import type { LogLevel } from "@loclyn/core";

const PAGE_SIZE = 50;

function LevelBadge({ level }: { level: LogLevel }) {
  return <span className={`log-badge log-${level}`}>{level}</span>;
}

export default function LogsPage() {
  const { logs } = useLoclynData();

  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const availableSources = useMemo(
    () => Array.from(new Set(logs.map((l) => l.source))).sort(),
    [logs],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (levelFilter !== "all" && l.level !== levelFilter) return false;
      if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
      if (needle && !l.message.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [logs, levelFilter, sourceFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function handleFilterChange<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  return (
    <div>
      <section className="panel">
        <div className="panel-header-row">
          <h2>Logs ({filtered.length} of {logs.length})</h2>
          <div className="filters">
            <input
              type="search"
              className="log-search"
              placeholder="Search messages"
              value={search}
              onChange={(e) => handleFilterChange(setSearch, e.target.value)}
            />
            <select
              value={levelFilter}
              onChange={(e) => handleFilterChange(setLevelFilter, e.target.value)}
            >
              <option value="all">All levels</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => handleFilterChange(setSourceFilter, e.target.value)}
            >
              <option value="all">All sources</option>
              {availableSources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {logs.length === 0 ? (
          <p className="empty-state">No log entries yet.</p>
        ) : filtered.length === 0 ? (
          <p className="empty-state">No log entries match the current filters.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th className="lg-time">Time</th>
                  <th className="lg-level">Level</th>
                  <th className="lg-source">Source</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => (
                  <tr key={l.id}>
                    <td className="dim">{new Date(l.time).toLocaleTimeString()}</td>
                    <td><LevelBadge level={l.level} /></td>
                    <td className="dim">{l.source}</td>
                    <td className="path-cell"><ScrollingText text={l.message} /></td>
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

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>About this page</h2>
        <p className="about-text">
          This is Loclyn&apos;s own log: service and tunnel changes, diagnostics, WebSocket
          connections and proxy errors. It does not show your apps&apos; console output, and individual
          requests are on the Requests page. The log is kept in memory (the latest 300 entries) and
          is cleared when Loclyn restarts.
        </p>
      </section>
    </div>
  );
}