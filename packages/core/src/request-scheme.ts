import type { IncomingHttpHeaders } from "node:http";

/**
 * The scheme the BROWSER used to reach the page.
 *
 * Cloudflare terminates TLS at its edge and talks plain HTTP to Loclyn, so the
 * local socket tells us nothing. Cloudflare reports the visitor's real scheme
 * in request headers instead. We read them in order of trust and never guess:
 *   1. X-Forwarded-Proto   (first value if it is a comma list)
 *   2. CF-Visitor          ({"scheme":"https"})
 *   3. Forwarded           (proto=https)
 * No header at all → null ("unknown"), which callers must NOT treat as https.
 */
export function requestScheme(headers: IncomingHttpHeaders): "https" | "http" | null {
  const norm = (v: string | undefined): "https" | "http" | null => {
    const s = v?.trim().toLowerCase();
    return s === "https" || s === "http" ? s : null;
  };

  const xfp = headers["x-forwarded-proto"];
  const first = (Array.isArray(xfp) ? xfp[0] : xfp)?.split(",")[0];
  const fromXfp = norm(first);
  if (fromXfp) return fromXfp;

  const cf = headers["cf-visitor"];
  if (typeof cf === "string") {
    try {
      const fromCf = norm((JSON.parse(cf) as { scheme?: string }).scheme);
      if (fromCf) return fromCf;
    } catch {
      // malformed header — ignore
    }
  }

  const fwd = headers["forwarded"];
  if (typeof fwd === "string") {
    const m = fwd.match(/(?:^|[;,\s])proto=("?)(https?)\1/i);
    if (m) return norm(m[2]);
  }
  return null;
}