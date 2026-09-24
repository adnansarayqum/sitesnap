import crypto from "node:crypto";

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

export function createTokenKey(env = process.env, cloudConfigured = false) {
  const raw = String(env.TOKEN_KEY || "");
  const production = !["development", "test"].includes(env.NODE_ENV);

  if (!raw) {
    if (production && cloudConfigured) throw new Error("TOKEN_KEY is required when cloud OAuth is configured");
    return null;
  }
  if (HEX_32_BYTES.test(raw)) return Buffer.from(raw, "hex");
  if (production) throw new Error("TOKEN_KEY must be exactly 64 hexadecimal characters (32 random bytes)");

  // Explicit development compatibility only. Production never accepts a
  // dictionary-derived encryption key for refresh-token blobs.
  return crypto.scryptSync(raw, "sitesnap-development-token-key", 32);
}
