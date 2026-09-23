import { describe, expect, it } from "vitest";
import { createAccessControl } from "../server/access.js";

describe("single-client access control", () => {
  it("fails closed when production AI credentials have no access key", () => {
    expect(() => createAccessControl({ NODE_ENV: "production", ANTHROPIC_API_KEY: "live-placeholder" }))
      .toThrow(/SITESNAP_ACCESS_KEY is required/);
    expect(() => createAccessControl({ ANTHROPIC_API_KEY: "live-placeholder" }))
      .toThrow(/SITESNAP_ACCESS_KEY is required/);
  });

  it("requires a suitably long key and rejects tampered or expired sessions", () => {
    expect(() => createAccessControl({ SITESNAP_ACCESS_KEY: "too-short" })).toThrow(/at least 16/);
    const access = createAccessControl({ SITESNAP_ACCESS_KEY: "correct horse battery staple" });
    expect(access.verifyPassphrase("correct horse battery staple")).toBe(true);
    expect(access.verifyPassphrase("correct horse battery staplf")).toBe(false);
    const token = access.makeToken(1_000);
    expect(access.verifyToken(token, 2_000)).toBe(true);
    expect(access.verifyToken(`${token.slice(0, -1)}x`, 2_000)).toBe(false);
    expect(access.verifyToken(token, 91 * 24 * 60 * 60 * 1000)).toBe(false);
  });
});
