"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";

export function Header() {
  const { wsConnected } = useLoclynData();

  return (
    <header className="header">
      <div className="header-title">Overview</div>
      <div className="header-status">
        <span className={`status-dot ${wsConnected ? "status-ok" : "status-error"}`} />
        <span>{wsConnected ? "Connected" : "Disconnected"}</span>
      </div>
    </header>
  );
}