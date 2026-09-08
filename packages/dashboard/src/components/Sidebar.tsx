"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Overview", href: "/", enabled: true },
  { label: "Services", href: "/services", enabled: true },
  { label: "Requests", href: "/requests", enabled: true },
  { label: "WebSockets", href: "/websockets", enabled: false },
  { label: "Diagnostics", href: "/diagnostics", enabled: true },
  { label: "Logs", href: "/logs", enabled: false },
  { label: "Settings", href: "/settings", enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">◆</span>
        <span className="brand-name">Loclyn</span>
      </div>

      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const isActive = item.enabled && pathname === item.href;

          if (!item.enabled) {
            return (
              <li key={item.label} className="nav-item nav-item-disabled" title="Coming soon">
                <span>{item.label}</span>
                <span className="nav-badge">Soon</span>
              </li>
            );
          }

          return (
            <li key={item.label} className={`nav-item ${isActive ? "nav-item-active" : ""}`}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}