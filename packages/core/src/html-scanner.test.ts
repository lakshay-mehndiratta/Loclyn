import { describe, expect, it } from "vitest";
import { CssResourceScanner, HtmlResourceScanner, scanCssText } from "./html-scanner.js";

function scan(html: string, chunk = html.length || 1) {
  const s = new HtmlResourceScanner();
  for (let i = 0; i < html.length; i += chunk) s.write(html.slice(i, i + chunk));
  s.end();
  return s.findings.map((f) => `${f.source} ${f.url}`);
}

describe("HtmlResourceScanner — flags resources the browser loads", () => {
  it("script src, stylesheet link, img src/srcset, iframe", () => {
    expect(
      scan(`<script src="http://a.com/x.js"></script>
            <link rel="stylesheet" href="http://a.com/s.css">
            <img src="http://a.com/i.png" srcset="http://a.com/i2.png 2x, https://ok.com/i3.png 3x">
            <iframe src="http://a.com/frame"></iframe>`),
    ).toEqual([
      "script src http://a.com/x.js",
      "link stylesheet http://a.com/s.css",
      "img src http://a.com/i.png",
      "img srcset http://a.com/i2.png",
      "iframe src http://a.com/frame",
    ]);
  });

  it("audio, video (+poster), source, track, object, embed", () => {
    expect(
      scan(`<audio src="http://a.com/a.mp3"></audio>
            <video src="http://a.com/v.mp4" poster="http://a.com/p.jpg"><source src="http://a.com/v.webm"><track src="http://a.com/t.vtt"></video>
            <picture><source srcset="http://a.com/p.avif"></picture>
            <object data="http://a.com/o.swf"></object><embed src="http://a.com/e.swf">`).sort(),
    ).toEqual(
      [
        "audio src http://a.com/a.mp3",
        "video src http://a.com/v.mp4",
        "video poster http://a.com/p.jpg",
        "source src http://a.com/v.webm",
        "track src http://a.com/t.vtt",
        "source srcset http://a.com/p.avif",
        "object data http://a.com/o.swf",
        "embed src http://a.com/e.swf",
      ].sort(),
    );
  });

  it("is case-insensitive and handles single-quoted and unquoted attributes", () => {
    expect(scan(`<SCRIPT SRC='http://a.com/1.js'></SCRIPT><IMG src=http://a.com/2.png>`)).toEqual([
      "script src http://a.com/1.js",
      "img src http://a.com/2.png",
    ]);
  });

  it("flags preload/modulepreload/icon links", () => {
    expect(
      scan(`<link rel="preload" href="http://a.com/f.woff2" as="font"><link rel="shortcut icon" href="http://a.com/f.ico">`),
    ).toEqual(["link preload http://a.com/f.woff2", "link icon http://a.com/f.ico"]);
  });

  it("drops the query string and fragment, and marks loopback URLs", () => {
    const s = new HtmlResourceScanner();
    s.write(`<img src="http://localhost:4000/a.png?token=SECRET#x">`);
    expect(s.findings).toEqual([{ url: "http://localhost:4000/a.png", source: "img src", loopback: true }]);
  });
});

describe("HtmlResourceScanner — does NOT flag", () => {
  it("anchors, form actions and non-loading link hints", () => {
    expect(
      scan(`<a href="http://a.com/page">x</a><form action="http://a.com/post"></form>
            <link rel="canonical" href="http://a.com/"><link rel="alternate" href="http://a.com/f">
            <link rel="preconnect" href="http://a.com"><link rel="dns-prefetch" href="http://a.com">`),
    ).toEqual([]);
  });

  it("https, protocol-relative, relative and data: URLs", () => {
    expect(
      scan(`<script src="https://a.com/x.js"></script><img src="//a.com/i.png"><img src="/local.png">
            <img src="data:image/png;base64,AAA"><link rel="stylesheet" href="s.css">`),
    ).toEqual([]);
  });

  it("tags inside HTML comments", () => {
    expect(scan(`<!-- <script src="http://a.com/x.js"></script> --><p>hi</p>`)).toEqual([]);
  });

  it("markup that only appears inside script text, noscript, template or textarea", () => {
    expect(
      scan(`<script>document.write('<img src="http://a.com/i.png">'); const s = "<script src=http://a.com/x.js>";</script>
            <noscript><img src="http://a.com/track.gif"></noscript>
            <template><img src="http://a.com/t.png"></template>
            <textarea><img src="http://a.com/ta.png"></textarea>`),
    ).toEqual([]);
  });

  it("resumes scanning normally after a script or template section", () => {
    expect(scan(`<script>var a = "<b>";</script><template><i></i></template><img src="http://a.com/after.png">`)).toEqual([
      "img src http://a.com/after.png",
    ]);
  });

  it("an http string in a data-* or other attribute", () => {
    expect(scan(`<div data-src="http://a.com/lazy.png" title="http://a.com/x"></div>`)).toEqual([]);
  });
});

describe("HtmlResourceScanner — streaming", () => {
  const html = `<!doctype html><html><head><style>.a{background:url("http://a.com/bg.png")}</style>
    <script src="http://a.com/x.js"></script></head><body><img srcset="http://a.com/1.png 1x" src="https://ok/2.png"></body></html>`;
  it("gives the same answer one character at a time as in one piece", () => {
    const whole = scan(html);
    expect(whole.length).toBe(3);
    expect(scan(html, 1)).toEqual(whole);
    expect(scan(html, 7)).toEqual(whole);
  });
});

describe("CSS", () => {
  it("flags url(http://…) in <style> blocks and style attributes", () => {
    expect(
      scan(`<style>.a{background:url(http://a.com/bg.png)} .b{background:url('https://ok/x.png')}</style>
            <div style="background-image:url(&quot;http://a.com/inline.png&quot;)"></div>`),
    ).toEqual(["style block url() http://a.com/bg.png", "style attribute url() http://a.com/inline.png"]);
  });

  it("ignores commented-out CSS and non-http urls", () => {
    expect(scanCssText(`/* url(http://a.com/x.png) */ .a{background:url(data:image/png;base64,AA)} .b{background:url(/rel.png)}`)).toEqual([]);
  });

  it("finds url() and @import in a CSS file", () => {
    const s = new CssResourceScanner();
    s.write(`@import "http://a.com/base.css";\n.a{background:url( 'http://a.com/i.png' )}\n`);
    s.end();
    expect(s.findings.map((f) => `${f.source} ${f.url}`).sort()).toEqual(
      ["css @import http://a.com/base.css", "css url() http://a.com/i.png"].sort(),
    );
  });
});