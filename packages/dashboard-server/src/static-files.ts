import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Serves a pre-built static site (the Next.js `output: "export"` folder).
 * Returns a handler that answers the request and returns true, or returns
 * false when nothing matches so the caller can send its own 404.
 *
 * Next exports each page as `<name>.html`, so a request for `/diagnostics`
 * is tried as `/diagnostics`, `/diagnostics.html`, then `/diagnostics/index.html`.
 * Files are only served from inside `root` — the real (symlink-resolved)
 * path is checked, so `..` tricks and symlinks can't escape it.
 */
export function createStaticHandler(root: string) {
  const base = fs.realpathSync(path.resolve(root));

  const find = (pathname: string): string | null => {
    const candidates = pathname.endsWith("/")
      ? [pathname + "index.html"]
      : [pathname, pathname + ".html", pathname + "/index.html"];
    for (const candidate of candidates) {
      const full = path.resolve(base, "." + candidate);
      try {
        if (!fs.statSync(full).isFile()) continue;
        const real = fs.realpathSync(full);
        if (real === base || real.startsWith(base + path.sep)) return real;
      } catch {
        // not found — try the next candidate
      }
    }
    return null;
  };

  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      return false;
    }
    if (pathname.includes("\0")) return false;

    const file = find(pathname);
    if (!file) return false;

    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    // Hashed build assets never change; the HTML pages must always be re-checked.
    const cache = pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
    return true;
  };
}