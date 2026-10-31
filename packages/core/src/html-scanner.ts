import type { InsecureResource } from "./types.js";

/**
 * Finds http:// references that a browser would actually LOAD as subresources.
 *
 * It is a small streaming tokenizer, not a regex over the whole document, so:
 *  - it works chunk by chunk (state survives between write() calls),
 *  - tags inside comments, <script>/<style> text, <noscript>, <template>,
 *    <textarea> and <iframe> fallback content are NOT treated as elements,
 *  - only attributes that make the browser fetch something are read.
 *    Anchors (<a href>), form actions and <link rel=canonical/alternate/
 *    preconnect/dns-prefetch> are navigation or hints, so they are ignored.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
const RAW_TEXT = new Set([
  "script", "style", "textarea", "title", "noscript", "iframe", "xmp", "noembed", "noframes",
]);
const LOADING_LINK_RELS = new Set(["stylesheet", "preload", "modulepreload", "icon", "apple-touch-icon"]);
const MAX_FINDINGS = 20;
const MAX_STYLE_CHARS = 64 * 1024;
const MAX_CSS_CHARS = 512 * 1024;
const MAX_VALUE_CHARS = 8192;

export interface ResourceScanner {
  write(text: string): void;
  end(): void;
  readonly findings: InsecureResource[];
}

/** Returns the URL (query/fragment dropped — they can hold tokens) if it is plain http. */
function insecureInfo(raw: string | undefined): { url: string; loopback: boolean } | null {
  if (!raw) return null;
  const v = raw.replace(/[\t\n\r]/g, "").trim();
  if (!/^http:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    return { url: u.origin + u.pathname, loopback: LOOPBACK.has(u.hostname.toLowerCase()) };
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** url(http://…) and @import "http://…" in CSS text, ignoring comments. */
export function scanCssText(css: string): { url: string; loopback: boolean; source: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out: { url: string; loopback: boolean; source: string }[] = [];
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi;
  const importRe = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of text.matchAll(urlRe)) {
    const info = insecureInfo(m[1] ?? m[2] ?? m[3]);
    if (info) out.push({ ...info, source: "css url()" });
  }
  for (const m of text.matchAll(importRe)) {
    const info = insecureInfo(m[1] ?? m[2]);
    if (info) out.push({ ...info, source: "css @import" });
  }
  return out;
}

class FindingList {
  readonly findings: InsecureResource[] = [];
  private seen = new Set<string>();

  add(raw: string | undefined, source: string): void {
    const info = insecureInfo(raw);
    if (!info || this.findings.length >= MAX_FINDINGS) return;
    const key = source + "|" + info.url;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.findings.push({ url: info.url, source, loopback: info.loopback });
  }

  addCss(css: string, fallbackSource: string): void {
    for (const f of scanCssText(css)) {
      this.add(f.url, f.source === "css url()" ? `${fallbackSource} url()` : f.source);
    }
  }
}

type State =
  | "data" | "tagOpen" | "markup" | "comment" | "bogus" | "endTag" | "tagName"
  | "beforeAttr" | "attrName" | "afterAttrName" | "beforeValue"
  | "valueDq" | "valueSq" | "valueUq" | "rawText";

const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isLetter = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

export class HtmlResourceScanner implements ResourceScanner {
  private list = new FindingList();
  private state: State = "data";
  private tagName = "";
  private attrs: Record<string, string> = {};
  private attrName = "";
  private attrValue = "";
  private markupBuf = "";
  private tail = "";
  private endName = "";
  private endNameOpen = false;
  private rawTag = "";
  private rawContent = "";
  private probe = "";
  private templateDepth = 0;

  get findings(): InsecureResource[] {
    return this.list.findings;
  }

  write(text: string): void {
    for (let i = 0; i < text.length; i++) this.step(text[i]);
  }

  end(): void {
    if (this.state === "rawText" && this.rawTag === "style") this.closeRaw();
  }

  private step(c: string): void {
    switch (this.state) {
      case "data":
        if (c === "<") this.state = "tagOpen";
        return;
      case "tagOpen":
        if (c === "!") { this.state = "markup"; this.markupBuf = ""; }
        else if (c === "/") { this.state = "endTag"; this.endName = ""; this.endNameOpen = true; }
        else if (isLetter(c)) { this.tagName = c.toLowerCase(); this.attrs = {}; this.state = "tagName"; }
        else if (c === "?") this.state = "bogus";
        else this.state = c === "<" ? "tagOpen" : "data";
        return;
      case "markup":
        this.markupBuf += c;
        if (c === ">") this.state = "data";
        else if (this.markupBuf.length === 2) {
          if (this.markupBuf === "--") { this.state = "comment"; this.tail = ""; }
          else this.state = "bogus";
        }
        return;
      case "comment":
        this.tail = (this.tail + c).slice(-4);
        if (this.tail.endsWith("-->") || this.tail.endsWith("--!>")) this.state = "data";
        return;
      case "bogus":
        if (c === ">") this.state = "data";
        return;
      case "endTag":
        if (c === ">") {
          if (this.endName === "template" && this.templateDepth > 0) this.templateDepth--;
          this.state = "data";
        } else if (this.endNameOpen && (isLetter(c) || (c >= "0" && c <= "9"))) this.endName += c.toLowerCase();
        else this.endNameOpen = false;
        return;
      case "tagName":
        if (isWs(c) || c === "/") this.state = "beforeAttr";
        else if (c === ">") this.finishTag();
        else this.tagName += c.toLowerCase();
        return;
      case "beforeAttr":
        if (isWs(c) || c === "/") return;
        if (c === ">") { this.finishTag(); return; }
        this.attrName = c.toLowerCase(); this.attrValue = ""; this.state = "attrName";
        return;
      case "attrName":
        if (c === "=") this.state = "beforeValue";
        else if (isWs(c)) this.state = "afterAttrName";
        else if (c === ">") { this.commitAttr(); this.finishTag(); }
        else if (c === "/") { this.commitAttr(); this.state = "beforeAttr"; }
        else this.attrName += c.toLowerCase();
        return;
      case "afterAttrName":
        if (isWs(c)) return;
        if (c === "=") this.state = "beforeValue";
        else if (c === ">") { this.commitAttr(); this.finishTag(); }
        else if (c === "/") { this.commitAttr(); this.state = "beforeAttr"; }
        else { this.commitAttr(); this.attrName = c.toLowerCase(); this.attrValue = ""; this.state = "attrName"; }
        return;
      case "beforeValue":
        if (isWs(c)) return;
        if (c === '"') this.state = "valueDq";
        else if (c === "'") this.state = "valueSq";
        else if (c === ">") { this.commitAttr(); this.finishTag(); }
        else { this.attrValue = c; this.state = "valueUq"; }
        return;
      case "valueDq":
      case "valueSq":
        if (c === (this.state === "valueDq" ? '"' : "'")) { this.commitAttr(); this.state = "beforeAttr"; }
        else if (this.attrValue.length < MAX_VALUE_CHARS) this.attrValue += c;
        return;
      case "valueUq":
        if (isWs(c)) { this.commitAttr(); this.state = "beforeAttr"; }
        else if (c === ">") { this.commitAttr(); this.finishTag(); }
        else if (this.attrValue.length < MAX_VALUE_CHARS) this.attrValue += c;
        return;
      case "rawText":
        this.rawStep(c);
        return;
    }
  }

  private commitAttr(): void {
    if (this.attrName && !(this.attrName in this.attrs)) {
      this.attrs[this.attrName] = decodeEntities(this.attrValue);
    }
    this.attrName = "";
    this.attrValue = "";
  }

  private finishTag(): void {
    const name = this.tagName;
    this.state = "data";
    if (name === "template") this.templateDepth++;
    if (this.templateDepth === 0) this.checkResources(name, this.attrs);
    if (RAW_TEXT.has(name)) {
      this.rawTag = name;
      this.rawContent = "";
      this.probe = "";
      this.state = "rawText";
    }
  }

  /** Inside <script>/<style>/…: only a matching close tag ends the section. */
  private rawStep(c: string): void {
    if (this.probe === "") {
      if (c === "<") this.probe = "<";
      else this.addRaw(c);
      return;
    }
    const target = "</" + this.rawTag;
    const next = this.probe + c;
    const lower = next.toLowerCase();
    if (lower.length <= target.length) {
      if (target.startsWith(lower)) { this.probe = next; return; }
    } else if (lower.length === target.length + 1 && lower.startsWith(target)) {
      if (c === ">") { this.closeRaw(); this.probe = ""; this.state = "data"; return; }
      if (isWs(c) || c === "/") {
        this.closeRaw(); this.probe = "";
        this.state = "endTag"; this.endName = ""; this.endNameOpen = false;
        return;
      }
    }
    this.addRaw(this.probe);
    this.probe = "";
    this.rawStep(c);
  }

  private addRaw(s: string): void {
    if (this.rawTag === "style" && this.rawContent.length < MAX_STYLE_CHARS) this.rawContent += s;
  }

  private closeRaw(): void {
    if (this.rawTag === "style" && this.templateDepth === 0) this.list.addCss(this.rawContent, "style block");
    this.rawContent = "";
  }

  private checkResources(name: string, a: Record<string, string>): void {
    const l = this.list;
    switch (name) {
      case "script": l.add(a.src, "script src"); break;
      case "link": {
        const hit = (a.rel ?? "").toLowerCase().split(/\s+/).find((r) => LOADING_LINK_RELS.has(r));
        if (hit) l.add(a.href, `link ${hit}`);
        break;
      }
      case "img": l.add(a.src, "img src"); this.srcset(a.srcset, "img srcset"); break;
      case "source": l.add(a.src, "source src"); this.srcset(a.srcset, "source srcset"); break;
      case "iframe": case "frame": l.add(a.src, `${name} src`); break;
      case "embed": l.add(a.src, "embed src"); break;
      case "object": l.add(a.data, "object data"); break;
      case "audio": l.add(a.src, "audio src"); break;
      case "video": l.add(a.src, "video src"); l.add(a.poster, "video poster"); break;
      case "track": l.add(a.src, "track src"); break;
      case "input": if ((a.type ?? "").toLowerCase() === "image") l.add(a.src, "input src"); break;
    }
    if (a.style) l.addCss(a.style, "style attribute");
  }

  private srcset(value: string | undefined, source: string): void {
    if (!value) return;
    for (const candidate of value.split(",")) {
      this.list.add(candidate.trim().split(/\s+/)[0], source);
    }
  }
}

/** CSS files: buffered (a bounded copy — the proxied bytes are untouched) and scanned at the end. */
export class CssResourceScanner implements ResourceScanner {
  private list = new FindingList();
  private buf = "";

  get findings(): InsecureResource[] {
    return this.list.findings;
  }

  write(text: string): void {
    if (this.buf.length < MAX_CSS_CHARS) this.buf += text;
  }

  end(): void {
    for (const f of scanCssText(this.buf)) this.list.add(f.url, f.source);
  }
}