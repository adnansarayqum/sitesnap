import { describe, expect, it } from "vitest";
import { createTokenKey } from "../server/token-key.js";

describe("cloud token encryption key", () => {
  it("requires random 32-byte hex in production", () => {
    expect(() => createTokenKey({ NODE_ENV: "production" }, true)).toThrow(/required/);
    expect(() => createTokenKey({ NODE_ENV: "production", TOKEN_KEY: "memorable passphrase" }, true)).toThrow(/64 hexadecimal/);
    expect(createTokenKey({ NODE_ENV: "production", TOKEN_KEY: "ab".repeat(32) }, true)).toHaveLength(32);
  });

  it("keeps explicit test/development compatibility without weakening production", () => {
    expect(createTokenKey({ NODE_ENV: "test", TOKEN_KEY: "test-only-passphrase" }, true)).toHaveLength(32);
  });
});
