"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  ListOrdered,
  Radio,
  Stethoscope,
  FileText,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  enabled: boolean;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", enabled: true, icon: LayoutDashboard },
  { label: "Services", href: "/services", enabled: true, icon: Server },
  { label: "Requests", href: "/requests", enabled: true, icon: ListOrdered },
  { label: "WebSockets", href: "/websockets", enabled: false, icon: Radio },
  { label: "Diagnostics", href: "/diagnostics", enabled: true, icon: Stethoscope },
  { label: "Logs", href: "/logs", enabled: false, icon: FileText },
  { label: "Settings", href: "/settings", enabled: false, icon: Settings },
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
          const Icon = item.icon;
          const isActive = item.enabled && pathname === item.href;

          if (!item.enabled) {
            return (
              <li key={item.label} className="nav-item nav-item-disabled" title="Coming soon">
                <span className="nav-item-content">
                  <Icon size={16} strokeWidth={1.75} />
                  <span>{item.label}</span>
                </span>
                <span className="nav-badge">Soon</span>
              </li>
            );
          }

          return (
            <li key={item.label} className={`nav-item ${isActive ? "nav-item-active" : ""}`}>
              <Link href={item.href} className="nav-item-content">
                <Icon size={16} strokeWidth={1.75} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}