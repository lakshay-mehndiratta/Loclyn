"use client";

import { usePathname } from "next/navigation";
import { useLoclynData } from "@/lib/LoclynDataContext";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/diagnostics": "Diagnostics",
  "/services": "Services",
};

export function Header() {
  const pathname = usePathname();
  const { wsConnected } = useLoclynData();
  const title = PAGE_TITLES[pathname] ?? "Loclyn";

  return (
    <header className="header">
      <div className="header-title">{title}</div>
      <div className="header-status">
        <span className={`status-dot ${wsConnected ? "status-ok" : "status-error"}`} />
        <span>{wsConnected ? "Connected" : "Disconnected"}</span>
      </div>
    </header>
  );
}