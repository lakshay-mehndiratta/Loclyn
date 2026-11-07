"use client";

import { Menu } from "lucide-react";
import { useMobileNav } from "./AppShell";

/** The "☰" button that opens the navigation on phones (hidden on desktop). */
export function MenuButton() {
  const { open, toggle } = useMobileNav();

  return (
    <button
      type="button"
      className="menu-button"
      onClick={toggle}
      aria-label="Open navigation"
      aria-expanded={open}
    >
      <Menu size={22} strokeWidth={1.75} />
    </button>
  );
}