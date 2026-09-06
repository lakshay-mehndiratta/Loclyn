"use client";

import { createContext, useContext } from "react";
import { useLoclynSocket, type LoclynData } from "./useLoclynSocket";

const LoclynDataContext = createContext<LoclynData | null>(null);

export function LoclynDataProvider({ children }: { children: React.ReactNode }) {
  const data = useLoclynSocket();
  return <LoclynDataContext.Provider value={data}>{children}</LoclynDataContext.Provider>;
}

export function useLoclynData(): LoclynData {
  const ctx = useContext(LoclynDataContext);
  if (!ctx) {
    throw new Error("useLoclynData must be used within a LoclynDataProvider");
  }
  return ctx;
}