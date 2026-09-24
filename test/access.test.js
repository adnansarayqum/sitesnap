import { describe, expect, it } from "vitest";
import { createAccessControl } from "../server/access.js";

describe("single-client access control", () => {
  it("fails closed when production AI credentials have no access key", () => {
    for (const env of [{ NODE_ENV: "production", ANTHROPIC_API_KEY: "live-placeholder" }, { ANTHROPIC_API_KEY: "live-placeholder" }, { NODE_ENV: "staging", OPENAI_API_KEY: "live-placeholder" }]) {
      const access = createAccessControl(env);
      let status;
      let body;
      let proceeded = false;
      const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
      access.requireAccess({}, res, () => { proceeded = true; });
      expect(access.capabilitiesLocked).toBe(true);
      expect({ status, body, proceeded }).toEqual({ status: 503, body: { error: "access_not_configured" }, proceeded: false });
    }
  });

  it.each(["development", "test"])("only relaxes capability locking in explicit %s mode", (NODE_ENV) => {
    expect(createAccessControl({ NODE_ENV, OPENAI_API_KEY: "local-placeholder" }).capabilitiesLocked).toBe(false);
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
