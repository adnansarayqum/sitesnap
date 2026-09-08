// Regression test for the reliability-pass fix: clientIp used to read the
// X-Forwarded-For header directly, which a caller can set to anything —
// letting anyone pick their own rate-limit bucket (or someone else's) by
// spoofing the header. It must resolve through Express's own req.ip, which
// (with `trust proxy` set to a hop count rather than `true`) only reflects
// the address the trusted edge proxy itself appended.
import { describe, expect, it } from "vitest";
import { clientIp, parseCookies } from "../server/auth.js";

describe("clientIp", () => {
  it("uses req.ip, not a raw X-Forwarded-For header a caller can spoof", () => {
    const spoofed = {
      ip: "10.0.0.5", // what Express resolved after trust-proxy processing
      get: (name) => (name.toLowerCase() === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : undefined),
    };
    expect(clientIp(spoofed)).toBe("10.0.0.5");
  });

  it("falls back to an empty string when req.ip is unset", () => {
    expect(clientIp({ ip: undefined, get: () => undefined })).toBe("");
  });
});

describe("parseCookies", () => {
  it("parses a standard cookie header into a map", () => {
    const req = { headers: { cookie: "ss_session=abc123; ss_pairbind=xyz789" } };
    expect(parseCookies(req)).toEqual({ ss_session: "abc123", ss_pairbind: "xyz789" });
  });

  it("returns an empty object when there's no cookie header", () => {
    expect(parseCookies({ headers: {} })).toEqual({});
  });

  it("URL-decodes cookie values", () => {
    const req = { headers: { cookie: "x=hello%20world" } };
    expect(parseCookies(req)).toEqual({ x: "hello world" });
  });
});
