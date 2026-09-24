// No accounts or org model — this is a single-client PWA. Generic cookie,
// rate-limit and IP helpers are used by deployment access and cloud linking.
// The legacy org helpers remain only for dormant schema-era code paths.
import { q } from "./db.js";

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

// ---- guards ----------------------------------------------------------------
// req.session/req.membership are always null (server/index.js sets them,
// there being no sign-in to populate them) — these only exist so the
// reference-pack / price-book routes below can gate on "an org" without
// each route needing its own null check, and correctly 401 rather than 500.
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
