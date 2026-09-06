import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { LoclynDataProvider } from "@/lib/LoclynDataContext";

export const metadata: Metadata = {
  title: "Loclyn",
  description: "Local dev bridge dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LoclynDataProvider>
          <div className="app-shell">
            <Sidebar />
            <div className="app-main">
              <Header />
              <main className="page-content">{children}</main>
            </div>
          </div>
        </LoclynDataProvider>
      </body>
    </html>
  );
}