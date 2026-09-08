// Sessions, sign-in codes, and the request-side guards. Cookie sessions,
// httpOnly — the token itself is never stored; sessions.id is its sha256.
import crypto from "node:crypto";
import { q, one } from "./db.js";

const SESSION_COOKIE = "ss_session";
const SESSION_DAYS = 90;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;

export const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// ---- cookies ---------------------------------------------------------------
export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function secure(req) {
  return (req.get("x-forwarded-proto") || req.protocol) === "https";
}

export function setSessionCookie(req, res, token) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? "; Secure" : ""}`);
}
export function clearSessionCookie(req, res) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? "; Secure" : ""}`);
}

// ---- rate limiting (in-memory; one process) --------------------------------
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n += 1;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return b.n <= max;
}
// req.ip, not a raw X-Forwarded-For read — Express resolves it against
// `trust proxy`'s hop count, so it's the address the trusted edge proxy
// itself appended, not the leftmost entry a caller can freely set by
// sending its own X-Forwarded-For header (which a raw header read, or an
// overly permissive `trust proxy: true`, would hand straight back and let
// a caller pick any IP-keyed rate-limit bucket it likes)
export const clientIp = (req) => req.ip || "";

// ---- users & sessions ------------------------------------------------------
export async function findOrCreateUser(email, name) {
  const e = normEmail(email);
  const existing = await one("select * from users where lower(email) = $1", [e]);
  if (existing) {
    if (name && !existing.name) await q("update users set name = $2 where id = $1", [existing.id, name]);
    return existing;
  }
  return one("insert into users (email, name) values ($1, $2) returning *", [e, name || null]);
}

export async function createSession(req, res, userId, orgId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  // default to the user's most recent org so a returning user lands in it
  const org = orgId || (await one(
    "select org_id from memberships where user_id = $1 order by created_at desc limit 1", [userId]))?.org_id || null;
  await q("insert into sessions (id, user_id, org_id, expires_at, user_agent) values ($1, $2, $3, $4, $5)",
    [sha256(token), userId, org, expires, String(req.get("user-agent") || "").slice(0, 200)]);
  await q("update users set last_seen_at = now() where id = $1", [userId]);
  if (res) setSessionCookie(req, res, token);
  return token;
}

export async function loadSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = await one("select * from sessions where id = $1 and expires_at > now()", [sha256(token)]);
  if (!s) return null;
  // slide the expiry forward at most once a day
  if (Date.now() - new Date(s.last_seen_at).getTime() > 86400 * 1000) {
    q("update sessions set last_seen_at = now(), expires_at = now() + interval '90 days' where id = $1", [s.id]).catch(() => {});
    q("update users set last_seen_at = now() where id = $1", [s.user_id]).catch(() => {});
  }
  return s;
}

export async function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await q("delete from sessions where id = $1", [sha256(token)]);
}

// ---- sign-in codes ---------------------------------------------------------
export async function issueCode(email) {
  const e = normEmail(email);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await q("insert into login_codes (email, code_hash, expires_at) values ($1, $2, $3)",
    [e, sha256(`${e}:${code}`), new Date(Date.now() + CODE_TTL_MS)]);
  return code;
}

export async function verifyCode(email, code) {
  const e = normEmail(email);
  const digits = String(code || "").replace(/\D/g, "");
  const row = await one(
    "select * from login_codes where lower(email) = $1 and used_at is null and expires_at > now() order by created_at desc limit 1", [e]);
  if (!row) return { ok: false, reason: "expired" };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: "too_many" };
  if (row.code_hash !== sha256(`${e}:${digits}`)) {
    await q("update login_codes set attempts = attempts + 1 where id = $1", [row.id]);
    return { ok: false, reason: "wrong" };
  }
  await q("update login_codes set used_at = now() where id = $1", [row.id]);
  return { ok: true };
}

// ---- guards ----------------------------------------------------------------
export async function attachSession(req, res, next) {
  try {
    req.session = await loadSession(req);
    if (req.session) {
      req.membership = req.session.org_id
        ? await one("select m.*, o.name as org_name from memberships m join orgs o on o.id = m.org_id where m.org_id = $1 and m.user_id = $2",
          [req.session.org_id, req.session.user_id])
        : null;
    }
    next();
  } catch (e) { next(e); }
}

export function requireUser(req, res, next) {
  if (!req.session) return res.status(401).json({ error: "sign_in" });
  next();
}

export function requireOrg(req, res, next) {
  if (!req.session) return res.status(401).json({ error: "sign_in" });
  if (!req.membership) return res.status(403).json({ error: "no_org" });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: "sign_in" });
  if (!req.membership || !["owner", "admin"].includes(req.membership.role)) return res.status(403).json({ error: "admin_only" });
  next();
}

export async function audit(req, action, target, detail) {
  try {
    await q("insert into audit_log (org_id, user_id, action, target, detail) values ($1, $2, $3, $4, $5)",
      [req.session?.org_id || null, req.session?.user_id || null, action, target || null, detail ? JSON.stringify(detail) : null]);
  } catch (e) { console.error("audit failed", e.message); }
}
