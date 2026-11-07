"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

interface MobileNav {
  /** Is the slide-in menu open? (only used on phones) */
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const MobileNavContext = createContext<MobileNav | null>(null);

export function useMobileNav(): MobileNav {
  const value = useContext(MobileNavContext);
  if (!value) throw new Error("useMobileNav must be used inside <AppShell>");
  return value;
}

/**
 * The outer frame of every page. On a phone the sidebar is a menu that slides
 * in over the page; this component owns whether that menu is open, so the
 * menu button (in the header) and the sidebar can share it without either
 * component needing to know about the other.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  // Going to another page closes the menu.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While the menu is open: Escape closes it, and the page behind it doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("nav-locked");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("nav-locked");
    };
  }, [open]);

  const value = useMemo(() => ({ open, toggle, close }), [open, toggle, close]);

  return (
    <MobileNavContext.Provider value={value}>
      <div className={open ? "app-shell nav-open" : "app-shell"}>
        {children}
        {/* Dimmed area beside the open menu; tapping it closes the menu. */}
        <div className="nav-overlay" onClick={close} aria-hidden="true" />
      </div>
    </MobileNavContext.Provider>
  );
}