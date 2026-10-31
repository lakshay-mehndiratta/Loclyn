import type { IncomingMessage } from "node:http";
import zlib from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { CssResourceScanner, HtmlResourceScanner, type ResourceScanner } from "./html-scanner.js";
import type { InsecureResource } from "./types.js";

/** Stop reading after this many (decompressed) bytes — dev pages are far smaller. */
export const MAX_SCAN_BYTES = 512 * 1024;

export type ScannableKind = "html" | "css";

export function scannableKind(contentType: unknown): ScannableKind | null {
  const ct = String(contentType ?? "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) return "html";
  if (ct.includes("text/css")) return "css";
  return null;
}

export interface ScanResult {
  insecure: InsecureResource[];
  incomplete: boolean;
}

/**
 * Watches a proxied response WITHOUT touching it. http-proxy already pipes
 * `proxyRes` to the browser; adding a second 'data' listener only gives us a
 * copy of each chunk as it passes. Nothing is delayed or buffered for the
 * browser, and pipe()'s backpressure still governs the stream.
 *
 * Compressed bodies are decompressed in a side stream (gzip, deflate, br).
 * Unknown encodings are skipped (returns null) rather than guessed at.
 */
export function scanResponse(proxyRes: IncomingMessage, kind: ScannableKind): Promise<ScanResult> | null {
  const enc = String(proxyRes.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  let decoder: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null;
  if (enc === "gzip" || enc === "x-gzip") decoder = zlib.createGunzip();
  else if (enc === "deflate") decoder = zlib.createInflate();
  else if (enc === "br") decoder = zlib.createBrotliDecompress();
  else if (enc !== "identity" && enc !== "") return null;

  const scanner: ResourceScanner = kind === "html" ? new HtmlResourceScanner() : new CssResourceScanner();
  const text = new StringDecoder("utf8");

  return new Promise<ScanResult>((resolve) => {
    let seen = 0;
    let done = false;
    let ended = false; // the response itself finished normally
    let incomplete = false;

    const finish = (): void => {
      if (done) return;
      done = true;
      try {
        scanner.write(text.end());
        scanner.end();
      } catch {
        // a scanner problem must never affect proxying
      }
      decoder?.destroy();
      resolve({ insecure: scanner.findings, incomplete });
    };

    const feed = (chunk: Buffer): void => {
      if (done) return;
      let part = chunk;
      if (seen + chunk.length > MAX_SCAN_BYTES) {
        part = chunk.subarray(0, MAX_SCAN_BYTES - seen);
        incomplete = true;
      }
      seen += part.length;
      try {
        scanner.write(text.write(part));
      } catch {
        incomplete = true;
      }
      if (incomplete) finish();
    };

    if (decoder) {
      decoder.on("data", feed);
      decoder.on("end", finish);
      decoder.on("error", () => { incomplete = true; finish(); });
      proxyRes.on("data", (c: Buffer) => { if (!done) decoder!.write(c); });
      proxyRes.on("end", () => { ended = true; if (!done) decoder!.end(); });
    } else {
      proxyRes.on("data", feed);
      proxyRes.on("end", () => { ended = true; finish(); });
    }
    // Aborted before 'end': report whatever was seen, flagged incomplete.
    // (After a normal 'end', 'close' fires before the decompressor has produced
    // its output, so it must not be treated as an abort.)
    proxyRes.on("close", () => { if (!done && !ended) { incomplete = true; finish(); } });
  });
}