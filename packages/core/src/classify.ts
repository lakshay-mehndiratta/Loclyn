import type { RequestKind } from "./types.js";

const ASSET_CONTENT_TYPES = ["text/css", "application/javascript", "text/javascript", "image/", "font/"];

const ASSET_EXTENSIONS = new Set([
  ".js", ".mjs", ".css", ".map",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
]);

/** Returns the lowercase extension of the URL's path (query/hash ignored),
 * or null if the last path segment has none. */
function extensionOf(requestPath: string): string | null {
  const pathname = requestPath.split("?")[0].split("#")[0];
  const dot = pathname.lastIndexOf(".");
  const slash = pathname.lastIndexOf("/");
  // A dot before the last slash belongs to a folder name ("/v1.2/users"), not a file.
  if (dot === -1 || dot < slash) return null;
  return pathname.slice(dot).toLowerCase();
}

/**
 * Classifies a request as document / asset / fetch.
 *
 * The response's Content-Type is the primary signal. When there is none
 * (typical for 304 Not Modified responses, which browsers send for cached
 * files), we fall back to the request path's file extension. We only ever
 * upgrade to "asset" from the extension, never to "document": a path with
 * no extension and no content type genuinely can't be classified, so it
 * stays "fetch" rather than being guessed.
 */
export function classify_Response(contentType: string | undefined, requestPath: string): RequestKind {
  if (contentType) {
    const type = contentType.toLowerCase();
    if (type.includes("text/html")) return "document";
    if (ASSET_CONTENT_TYPES.some((prefix) => type.includes(prefix))) return "asset";
    return "fetch";
  }

  const ext = extensionOf(requestPath);
  if (ext && ASSET_EXTENSIONS.has(ext)) return "asset";

  return "fetch";
}