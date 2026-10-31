import { describe, expect, it } from "vitest";
import { requestScheme } from "./request-scheme.js";

describe("requestScheme", () => {
  it("reads X-Forwarded-Proto (first value of a list)", () => {
    expect(requestScheme({ "x-forwarded-proto": "https" })).toBe("https");
    expect(requestScheme({ "x-forwarded-proto": "https, http" })).toBe("https");
    expect(requestScheme({ "x-forwarded-proto": "http" })).toBe("http");
  });
  it("falls back to CF-Visitor, then Forwarded", () => {
    expect(requestScheme({ "cf-visitor": '{"scheme":"https"}' })).toBe("https");
    expect(requestScheme({ forwarded: "for=1.2.3.4;proto=https;by=x" })).toBe("https");
  });
  it("lets an explicit http beat a later https hint", () => {
    expect(requestScheme({ "x-forwarded-proto": "http", "cf-visitor": '{"scheme":"https"}' })).toBe("http");
  });
  it("returns null (unknown) with no signal — never assumes https", () => {
    expect(requestScheme({ host: "abc.trycloudflare.com" })).toBeNull();
    expect(requestScheme({ "cf-visitor": "not json" })).toBeNull();
  });
});