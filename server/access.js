import crypto from "node:crypto";
import { clientIp, parseCookies, rateLimit } from "./auth.js";

const COOKIE = "ss_access";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LIVE_AI_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();
const b64 = (value) => Buffer.from(value).toString("base64url");

function sameOrigin(req, publicUrl) {
  const origin = req.get("origin");
  if (!origin) return false;
  let expected;
  try { expected = publicUrl ? new URL(publicUrl).origin : `${req.protocol}://${req.get("host")}`; }
  catch { return false; }
  try { return new URL(origin).origin === expected; } catch { return false; }
}

export function createAccessControl(env = process.env) {
  // `npm start` is a production server even when a platform forgot to set
  // NODE_ENV. Only an explicit development/test process may run unprotected.
  const production = !["development", "test"].includes(env.NODE_ENV);
  const passphrase = String(env.SITESNAP_ACCESS_KEY || "");
  const enabled = !!passphrase;
  const liveAi = LIVE_AI_KEYS.some((name) => !!env[name]);
  if (enabled && passphrase.length < 16) throw new Error("SITESNAP_ACCESS_KEY must be at least 16 characters");
  if (passphrase.length > 1024) throw new Error("SITESNAP_ACCESS_KEY must be at most 1024 characters");
  const capabilitiesLocked = production && liveAi && !enabled;

  const passDigest = enabled ? digest(passphrase) : null;
  const signingKey = enabled ? crypto.hkdfSync("sha256", Buffer.from(passphrase), Buffer.from("sitesnap-access-v1"), Buffer.from("session-cookie"), 32) : null;
  const days = Math.min(90, Math.max(1, Number(env.SITESNAP_SESSION_DAYS) || 30));
  const maxAgeSeconds = days * 24 * 60 * 60;

  const sign = (payload) => crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");

  function makeToken(now = Date.now()) {
    const payload = b64(JSON.stringify({ v: 1, exp: now + maxAgeSeconds * 1000, nonce: crypto.randomBytes(12).toString("base64url") }));
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token, now = Date.now()) {
    if (!enabled || typeof token !== "string") return false;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return false;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    try {
      const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return value.v === 1 && Number.isFinite(value.exp) && value.exp > now;
    } catch { return false; }
  }

  function verifyPassphrase(candidate) {
    if (!enabled) return false;
    const supplied = digest(String(candidate || "").slice(0, 1024));
    return crypto.timingSafeEqual(supplied, passDigest);
  }

  function cookie(req, token, age = maxAgeSeconds) {
    const secure = production || req.secure || req.get("x-forwarded-proto") === "https";
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  }

  function middleware(req, res, next) {
    req.access = { enabled, authenticated: enabled && verifyToken(parseCookies(req)[COOKIE]) };
    next();
  }

  function requireAccess(req, res, next) {
    if (!enabled) {
      if (production) return res.status(503).json({ error: "access_not_configured" });
      return next();
    }
    if (!req.access?.authenticated) return res.status(401).json({ error: "access_required" });
    next();
  }

  function requireSameOrigin(req, res, next) {
    if (!enabled || SAFE_METHODS.has(req.method)) return next();
    if (!sameOrigin(req, env.PUBLIC_URL)) return res.status(403).json({ error: "bad_origin" });
    next();
  }

  function mount(app) {
    app.use(middleware);
    app.get("/api/session", (req, res) => res.json({ required: enabled, authenticated: !!req.access.authenticated, capabilitiesLocked }));
    app.post("/api/session", requireSameOrigin, (req, res) => {
      const ip = clientIp(req);
      if (!rateLimit(`access-login:${ip}`, 8, 15 * 60 * 1000) || !rateLimit("access-login:global", 100, 15 * 60 * 1000)) {
        res.set("Retry-After", "900");
        return res.status(429).json({ error: "slow_down" });
      }
      if (!verifyPassphrase(req.body?.passphrase)) return res.status(401).json({ error: "invalid_access_key" });
      res.set("Set-Cookie", cookie(req, makeToken()));
      res.json({ ok: true });
    });
    app.delete("/api/session", requireSameOrigin, requireAccess, (req, res) => {
      res.set("Set-Cookie", cookie(req, "", 0));
      res.json({ ok: true });
    });
  }

  return { enabled, production, capabilitiesLocked, mount, requireAccess, requireSameOrigin, verifyPassphrase, verifyToken, makeToken };
}
