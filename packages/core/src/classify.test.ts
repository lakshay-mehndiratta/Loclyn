import { describe, it, expect } from "vitest";
import { classify_Response } from "./classify.js";

describe("classifyResponse — by Content-Type", () => {
  it("classifies HTML as document", () => {
    expect(classify_Response("text/html; charset=utf-8", "/")).toBe("document");
  });

  it("classifies css, javascript, images, and fonts as asset", () => {
    expect(classify_Response("text/css", "/x")).toBe("asset");
    expect(classify_Response("application/javascript", "/x")).toBe("asset");
    expect(classify_Response("image/png", "/x")).toBe("asset");
    expect(classify_Response("font/woff2", "/x")).toBe("asset");
  });

  it("classifies JSON as fetch", () => {
    expect(classify_Response("application/json", "/api/users")).toBe("fetch");
  });

  it("trusts the content type over the file extension", () => {
    expect(classify_Response("application/json", "/data.png")).toBe("fetch");
  });
});

describe("classifyResponse — extension fallback (no Content-Type, e.g. 304)", () => {
  it("classifies known asset extensions as asset", () => {
    expect(classify_Response(undefined, "/_next/static/chunks/main.js")).toBe("asset");
    expect(classify_Response(undefined, "/styles/app.css")).toBe("asset");
  });

  it("ignores the query string when reading the extension", () => {
    expect(classify_Response(undefined, "/favicon.ico?favicon.0o4j4wo9k05ap.ico")).toBe("asset");
  });

  it("is case-insensitive", () => {
    expect(classify_Response(undefined, "/LOGO.PNG")).toBe("asset");
  });

  it("leaves extensionless paths as fetch", () => {
    expect(classify_Response(undefined, "/")).toBe("fetch");
    expect(classify_Response(undefined, "/api/users")).toBe("fetch");
  });

  it("does not treat a dot in a folder name as an extension", () => {
    expect(classify_Response(undefined, "/v1.2/users")).toBe("fetch");
  });

  it("leaves unknown extensions as fetch", () => {
    expect(classify_Response(undefined, "/data.json")).toBe("fetch");
  });
});