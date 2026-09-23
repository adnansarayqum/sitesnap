// SiteSnap's backend, built for Stonebridge Surveyors — a single-user PWA
// for Shahriar Hussain. Serves the built app. If TOKEN_KEY and a provider's
// secrets are set, the cloud-link service works statelessly: the refresh
// token is sealed and kept on the phone (see docs/frictionless-cloud-link.md).
// Secrets never leave this process; the phone only ever holds a sealed blob
// it can't read.
//
// A database is optional and, if configured, runs the retained migrations;
// it never enables the abandoned account/org mode or a server-side register.
import { captureServerError, captureFatal, sentryEnabled } from "./sentry.js"; // first: see server/sentry.js
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasDb, migrate, closeDb, q } from "./db.js";
import { rateLimit, clientIp, normEmail, validEmail, parseCookies } from "./auth.js";
import { emailConfigured } from "./email.js";
import { mountAi } from "./ai-routes.js";
import { mountProduct } from "./product.js";
import { aiEnabled, transcriptionEnabled, AI_MODEL } from "./ai.js";
import { createAccessControl } from "./access.js";
import { createTokenKey } from "./token-key.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env.SITESNAP_DIST_DIR ? path.resolve(process.env.SITESNAP_DIST_DIR) : path.join(__dirname, "..", "dist");
const PORT = process.env.PORT || 3000;
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
const releaseIdentity = (value) => String(value || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || null;
const access = createAccessControl();
let optionalDbStatus = hasDb ? "starting" : "not_configured";

const PROVIDERS = {
  onedrive: {
    label: "OneDrive",
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    // "common": personal Microsoft accounts and work/school accounts alike
    authUrl: process.env.MS_AUTH_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: process.env.MS_TOKEN_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revokeUrl: null, // Microsoft has no per-app revoke endpoint; the account's "apps you've given access to" page does it
    // .AppFolder, not the bare scope: confines the app to its own isolated
    // OneDrive folder rather than the whole drive (see src/cloud/msGraph.js)
    scope: "openid profile email offline_access Files.ReadWrite.AppFolder",
    authParams: {},
  },
  google: {
    label: "Google Drive",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authUrl: process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    revokeUrl: process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke",
    // drive.file: only files this app created — never the whole Drive
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    authParams: { access_type: "offline", prompt: "consent" },
  },
};

// ---- sealing -------------------------------------------------------------
// Production accepts only 32 bytes of random key material. A human-memorable
// passphrase makes a stolen sealed refresh-token blob vulnerable to offline
// dictionary guessing.
const CLOUD_CONFIGURED = Object.values(PROVIDERS).some((provider) => provider.clientId || provider.clientSecret);
const KEY = createTokenKey(process.env, CLOUD_CONFIGURED);

function enabled(provider) {
  const c = PROVIDERS[provider];
  return !!(c && c.clientId && c.clientSecret && KEY);
}

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ct]).toString("base64url");
}

function unseal(blob) {
  const b = Buffer.from(String(blob || ""), "base64url");
  if (b.length < 1 + 12 + 16 + 2 || b[0] !== 1) throw new Error("bad blob");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, b.subarray(1, 13));
  decipher.setAuthTag(b.subarray(13, 29));
  return JSON.parse(Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]).toString("utf8"));
}

// ---- pairing -------------------------------------------------------------
// The phone asks for a pairing code, opens the sign-in with it, and polls
// for the result. That way it doesn't matter which browser the provider
// sends the callback to — an installed iOS web app and Safari keep separate
// storage, and the callback can land in either. Used both for linking a
// drive ("link") and for signing in with Microsoft/Google ("signin").
const pending = new Map(); // pair -> { created, provider, purpose, userId?, bind, result? }
const PAIR_TTL_MS = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.created > PAIR_TTL_MS) pending.delete(k);
}
setInterval(sweep, 60 * 1000).unref();

// the OAuth `state` is the pair code plus an HMAC, so a callback can only
// ever complete the pairing it was started for
const sign = (pair) => crypto.createHmac("sha256", KEY).update(pair).digest("base64url").slice(0, 22);
function sameSecret(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return `${proto}://${req.get("host")}`;
}

// A `pair` value is a bearer credential for whatever it resolves to — for a
// "signin" pairing, a claimed session. Without binding it to the browser
// that started it, anyone could create their own valid pairing, complete it
// as themselves, and hand the pair value to someone else as a link; that
// person's browser would silently be handed the *attacker's* session on
// claim. This cookie is set only on the request that creates a pairing and
// checked on claim, so the value alone — however it's obtained — isn't
// enough; it must come from the same browser that started it. Every
// legitimate caller (beginLink's popup-then-poll, oauthSignIn, and the
// same-tab ?cloudpair= redirect pickup) already polls or returns from the
// same tab that made the initial request, so this changes nothing for them.
const PAIR_BIND_COOKIE = "ss_pairbind";
function pairSecure(req) { return (req.get("x-forwarded-proto") || req.protocol) === "https"; }
function bindPairCookie(req, res) {
  const token = crypto.randomBytes(16).toString("base64url");
  res.append("Set-Cookie", `${PAIR_BIND_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.ceil(PAIR_TTL_MS / 1000)}${pairSecure(req) ? "; Secure" : ""}`);
  return token;
}
const pairBindFromReq = (req) => parseCookies(req)[PAIR_BIND_COOKIE] || null;

function newPair(provider, purpose, userId, bind) {
  sweep();
  const pair = crypto.randomBytes(16).toString("base64url");
  pending.set(pair, { created: Date.now(), provider, purpose, userId: userId || null, bind });
  return pair;
}

async function exchange(provider, params) {
  const c = PROVIDERS[provider];
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params });
  const r = await fetch(c.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) {
    const e = new Error(json.error_description || json.error || `token endpoint returned ${r.status}`);
    e.code = json.error || "token_error";
    throw e;
  }
  return json;
}

// what the id_token says about the account — both providers return one
// when `openid email` is in the scope
function identityFrom(tok) {
  try {
    const p = JSON.parse(Buffer.from(String(tok.id_token).split(".")[1], "base64url").toString("utf8"));
    const email = p.email || p.preferred_username || p.upn || "";
    return { email: validEmail(normEmail(email)) ? normEmail(email) : "", name: p.name || "", label: email || p.name || "" };
  } catch { return { email: "", name: "", label: "" }; }
}

async function refreshAccess(provider, refreshToken) {
  return exchange(provider, { grant_type: "refresh_token", refresh_token: refreshToken, scope: PROVIDERS[provider].scope });
}

async function revokeAtProvider(provider, refreshToken) {
  const c = PROVIDERS[provider];
  if (!c || !c.revokeUrl) return;
  try { await fetch(`${c.revokeUrl}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }); } catch { /* best effort */ }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function page(title, text, backHref) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stonebridge Surveyors</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F6F6F3;color:#14201B;font:16px/1.5 system-ui,sans-serif}
main{max-width:360px;padding:32px 28px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#5E6B64;margin:0 0 20px}
a{display:inline-block;background:#10352A;color:#fff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 22px}</style>
<main><h1>${esc(title)}</h1><p>${esc(text)}</p>${backHref ? `<a href="${esc(backHref)}">Back to SiteSnap</a>` : ""}</main>`;
}

// ---- "me": what the app needs to know at boot -----------------------------
// No accounts, no sign-in — this exists only so the phone can read which
// cloud providers are configured and whether email is set up.
async function me() {
  return { mode: "local", providers: { onedrive: enabled("onedrive"), google: enabled("google") }, email: emailConfigured };
}

// ---- app -----------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
// trust exactly one hop — Railway's own edge proxy — not the whole chain.
// `true` trusts every hop including ones a caller can add itself, so
// reading req.ip (the rate limiter's IP-bucket key) would hand back
// whatever address a caller's own X-Forwarded-For claims rather than the
// one Railway's edge actually appended.
app.set("trust proxy", 1);
// Every external origin the app actually talks to, so a CSP violation means
// something is genuinely wrong, not a false alarm to click through:
//   fonts.googleapis.com / fonts.gstatic.com — the two Google Fonts hosts
//     src/styles.jsx's inline stylesheet @imports (style-src needs
//     'unsafe-inline' for that inline <style> block itself, not just this)
//   graph.microsoft.com — direct-to-OneDrive uploads (src/cloud/msGraph.js)
//   login.microsoftonline.com — MSAL's popup sign-in and its hidden-iframe
//     silent token refresh (connect-src and frame-src respectively)
//   accounts.google.com / www.googleapis.com — the legacy in-browser Google
//     Drive path (src/cloud/googleDrive.js), settings-hidden but still
//     reachable if VITE_GOOGLE_CLIENT_ID is set
//   *.sentry.io — only reached at all once SENTRY_DSN/VITE_SENTRY_DSN are
//     set; the exact ingest host varies by org/region, hence the wildcard
//     scoped to Sentry's own domain rather than an exact host
const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' only permits compiling/running WebAssembly (needed by
  // the on-device OCR worker) — unlike 'unsafe-eval' it does not allow
  // eval()/new Function() on arbitrary strings, so this doesn't reopen the
  // XSS surface CSP is there to close
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  // `https:` rather than a host list: the CRM/ERP export posts to whatever
  // HTTPS address a firm's admin configures, which a fixed list can't know.
  // Scripts stay 'self'-only, so this only widens where an already-running
  // page may send requests, not what can run. CSP_CONNECT_EXTRA adds
  // space-separated origins on top (a plain-http receiver in development).
  `connect-src 'self' https:${process.env.CSP_CONNECT_EXTRA ? " " + process.env.CSP_CONNECT_EXTRA.trim() : ""}`,
  // the on-device OCR worker (tesseract.js) is spawned from a same-origin
  // script wrapped in a blob: URL, not loaded directly — Worker construction
  // needs blob: explicitly, 'self' alone doesn't cover it
  "worker-src 'self' blob:",
  "frame-src https://login.microsoftonline.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set("X-Frame-Options", "DENY");
  res.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  res.set("Content-Security-Policy", CSP);
  // browsers only honor this once they've seen it over a real HTTPS
  // response, so it's harmless to always send — Railway terminates TLS in
  // front of this process, but the app doesn't get to assume that stays
  // true forever, so it sets its own rather than relying on the edge
  res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
// the AI routes carry photographs and raw audio and parse their own bodies
// (ai-routes.js); everything else is small JSON
// originalUrl, not path: inside app.use("/api", ...) the mount prefix is
// stripped from req.path
const requestPath = (req) => String(req.originalUrl || req.url).split("?")[0].toLowerCase();
const isAi = (req) => requestPath(req).startsWith("/api/ai/");
const jsonBody = express.json({ limit: "4mb" });
app.use((req, res, next) => (isAi(req) ? next() : jsonBody(req, res, next)));
access.mount(app);
// every mutating API call is JSON from our own page; a cross-site form
// post can't set that content type, and SameSite=Lax keeps the cookie
// off cross-site posts anyway. DELETE carries no body and can't be sent
// by a form at all (a cross-site fetch DELETE needs a CORS preflight).
// The one exception is a voice note posted as audio/* to the AI route —
// still not a content type a form can produce.
app.use("/api", (req, res, next) => {
  const mutating = !["GET", "HEAD", "DELETE"].includes(req.method);
  const audioOk = isAi(req) && /\/transcribe$/.test(String(req.originalUrl || "").split("?")[0]) && (req.is("audio/*") || req.is("video/webm") || req.is("application/octet-stream"));
  if (mutating && !req.is("application/json") && !audioOk) return res.status(415).json({ error: "json_only" });
  res.set("Cache-Control", "no-store");
  next();
});
// Use Express's own case-insensitive, trailing-slash-tolerant matcher for
// authorization as well as dispatch. A separately parsed originalUrl can
// disagree with Express and turn path variants into an auth bypass.
const protect = [access.requireSameOrigin, access.requireAccess];
app.use("/api/ai", ...protect);
app.use("/api/price-book", ...protect);
app.use("/api/admin", ...protect);
for (const route of ["/api/cloud/pair", "/api/cloud/claim", "/api/cloud/token", "/api/cloud/revoke", "/api/events", "/api/feedback"]) {
  app.all(route, ...protect);
}
// Legacy org code stays inert even when DATABASE_URL is configured.
app.use((req, res, next) => { req.session = null; req.membership = null; next(); });
mountAi(app);
mountProduct(app);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/healthz", (req, res) => {
  const dbOk = optionalDbStatus === "ok" ? true : optionalDbStatus === "unavailable" ? false : null;
  // Postgres is retained only for optional migrations/reference schema. It
  // must not take the local-first capture app out of service.
  res.json({ ok: true, mode: "local", db: dbOk });
});

app.get("/readyz", (req, res) => {
  res.json({
    status: "ok",
    version: APP_VERSION,
    commit: releaseIdentity(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA),
    release: releaseIdentity(process.env.RAILWAY_DEPLOYMENT_ID || process.env.RELEASE_ID),
  });
});

app.get("/api/config", wrap(async (req, res) => {
  res.json({ mode: "local", providers: { onedrive: enabled("onedrive"), google: enabled("google") }, email: emailConfigured });
}));
// older clients
app.get("/api/cloud/config", (req, res) => res.json({ onedrive: enabled("onedrive"), google: enabled("google") }));

app.get("/api/me", wrap(async (req, res) => res.json(await me())));

// ---- cloud link pairing -----------------------------------------------
app.post("/api/cloud/pair", wrap(async (req, res) => {
  const provider = String((req.body && req.body.provider) || "");
  if (!enabled(provider)) return res.status(404).json({ error: "provider not configured" });
  const bind = bindPairCookie(req, res);
  const pair = newPair(provider, "link", undefined, bind);
  res.json({ pair, url: `${baseUrl(req)}/auth/${provider}/start?pair=${pair}` });
}));

app.get("/auth/:provider/start", access.requireAccess, (req, res) => {
  const { provider } = req.params;
  const pair = String(req.query.pair || "");
  const p = pending.get(pair);
  if (!enabled(provider) || !p || p.provider !== provider) {
    return res.status(400).send(page("This sign-in link has expired", "Go back to SiteSnap and tap Connect again.", baseUrl(req)));
  }
  const c = PROVIDERS[provider];
  const u = new URL(c.authUrl);
  u.search = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    redirect_uri: `${baseUrl(req)}/auth/${provider}/callback`,
    scope: c.scope,
    state: `${pair}.${sign(pair)}`,
    ...c.authParams,
  }).toString();
  res.redirect(u.toString());
});

app.get("/auth/:provider/callback", wrap(async (req, res) => {
  const { provider } = req.params;
  const [pair, sig] = String(req.query.state || "").split(".");
  const p = pending.get(pair);
  if (!enabled(provider) || !p || p.provider !== provider || !sameSecret(sig, sign(pair))) {
    return res.status(400).send(page("This sign-in link has expired", "Go back to SiteSnap and tap Connect again.", baseUrl(req)));
  }
  if (req.query.error) {
    pending.delete(pair);
    return res.status(400).send(page("Sign-in was cancelled", String(req.query.error_description || req.query.error), baseUrl(req)));
  }
  const label = PROVIDERS[provider].label;
  const back = `${baseUrl(req)}/?cloudpair=${encodeURIComponent(pair)}`;
  try {
    const tok = await exchange(provider, {
      grant_type: "authorization_code",
      code: String(req.query.code || ""),
      redirect_uri: `${baseUrl(req)}/auth/${provider}/callback`,
      scope: PROVIDERS[provider].scope,
    });
    const who = identityFrom(tok);
    if (!tok.refresh_token) throw new Error("The sign-in didn't include a lasting token — for Google, remove SiteSnap's access at myaccount.google.com/permissions and try again.");

    p.result = { blob: seal({ v: 1, p: provider, rt: tok.refresh_token, acct: who.label, iat: Date.now() }), account: who.label };
    res.send(page(`${label} connected${who.label ? " as " + who.label : ""}`, "SiteSnap has already picked this up — you can close this.", back));
  } catch (e) {
    pending.delete(pair);
    res.status(502).send(page("Couldn't finish connecting", e.message, baseUrl(req)));
  }
}));

// polled by the phone
app.get("/api/cloud/claim", wrap(async (req, res) => {
  const pair = String(req.query.pair || "");
  const p = pending.get(pair);
  if (!p) return res.status(404).json({ status: "expired" });
  // the pair value alone isn't enough to claim it — only the browser that
  // started this pairing (and so holds the matching cookie) can. Left in
  // `pending` (not deleted) so the real browser can still claim it.
  if (!sameSecret(pairBindFromReq(req), p.bind)) return res.status(403).json({ status: "forbidden" });
  if (!p.result) return res.json({ status: "pending" });
  pending.delete(pair);
  res.json({ status: "done", purpose: "link", provider: p.provider, ...p.result });
}));

app.post("/api/cloud/token", wrap(async (req, res) => {
  // a runaway client must not hammer Microsoft or Google with refreshes
  if (!rateLimit(`token:${clientIp(req)}`, 120, 10 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
  // the sealed blob is the credential
  let inner;
  try { inner = unseal(req.body && req.body.blob); } catch { return res.status(401).json({ error: "reconnect" }); }
  const provider = inner.p;
  if (!enabled(provider)) return res.status(404).json({ error: "provider not configured" });
  try {
    const tok = await refreshAccess(provider, inner.rt);
    const out = { access_token: tok.access_token, expires_in: tok.expires_in || 3600, account: inner.acct || "" };
    // Microsoft rotates the refresh token on every use — hand the phone the
    // re-sealed one so the connection keeps sliding forward
    if (tok.refresh_token && tok.refresh_token !== inner.rt) out.blob = seal({ ...inner, rt: tok.refresh_token, iat: Date.now() });
    res.json(out);
  } catch (e) {
    if (e.code === "invalid_grant") return res.status(401).json({ error: "reconnect" });
    res.status(502).json({ error: e.message });
  }
}));

app.post("/api/cloud/revoke", wrap(async (req, res) => {
  let inner;
  try { inner = unseal(req.body && req.body.blob); } catch { return res.json({ ok: true }); }
  await revokeAtProvider(inner.p, inner.rt);
  res.json({ ok: true });
}));

// ---- the app itself --------------------------------------------------------
app.use(express.static(DIST, {
  index: false,
  setHeaders(res, filePath) {
    // hashed bundles can be cached forever; everything else must revalidate
    // so a deploy is picked up on the next open
    res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache");
  },
}));
// an unknown API path is a JSON 404 whatever the method — never Express's
// HTML error page, which a fetch() caller can't read
app.all("/api/{*splat}", (req, res) => res.status(404).json({ error: "not found" }));
app.all("/auth/{*splat}", (req, res) => res.status(404).json({ error: "not found" }));
// Express 5 (path-to-regexp 8) needs the catch-all named; the braces make
// the segment optional so the bare "/" is caught too
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return res.status(404).json({ error: "not found" });
  // Read explicitly rather than relying on sendFile's platform-specific path
  // resolution; this is the same file for every SPA navigation in a deploy.
  fs.readFile(path.join(DIST, "index.html"), (err, html) => {
    if (err) return next(err);
    res.set("Cache-Control", "no-cache").type("html").send(html);
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.path}:`, err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err);
  // a caller-facing 4xx (bad input, not signed in, a validation rule) isn't
  // a bug to be paged for — only genuine server-side failures are
  if (!err || !err.status || err.status >= 500) captureServerError(err, req);
  if (res.headersSent) return;
  // `error` is the short code callers can branch on; `message` is the
  // human sentence — src/ai.js's readError() reads the latter, so a
  // thrown Error's actual guidance (e.g. "try fewer photos for this
  // room") reaches the UI instead of degrading to a generic fallback.
  const msg = err && err.status ? err.message : "Something went wrong on the server.";
  res.status(err && err.status ? err.status : 500).json({ error: (err && err.code) || msg, message: msg });
});

// expired sessions, spent codes and stale invitations are dropped on boot
// and every six hours; nothing a person can still use is touched
async function purge() {
  try {
    await q("delete from sessions where expires_at < now()");
    await q("delete from login_codes where expires_at < now() - interval '1 day'");
    await q("delete from invites where accepted_at is null and expires_at < now() - interval '30 days'");
  } catch (e) { console.error("purge failed:", e.message); }
}

export async function startServer() {
  if (hasDb) {
    // Migrations run independently of the local-first web server. Even a
    // reachable database blocked on a lock must not delay camera capture.
    migrate()
      .then(async () => {
        optionalDbStatus = "ok";
        await purge();
        setInterval(purge, 6 * 60 * 60 * 1000).unref();
      })
      .catch((e) => {
        optionalDbStatus = "unavailable";
        console.error("optional database unavailable; continuing without it:", e.message);
      });
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    const on = Object.keys(PROVIDERS).filter(enabled);
    console.log(`SiteSnap (Stonebridge Surveyors) on :${PORT} — cloud link: ${on.length ? on.join(", ") : "off (set TOKEN_KEY plus a provider's client ID and secret)"}; email: ${emailConfigured ? "resend" : "log only"}; drafting: ${aiEnabled() ? AI_MODEL : "off (set ANTHROPIC_API_KEY)"}; transcription: ${transcriptionEnabled() ? "on" : "off (set OPENAI_API_KEY)"}; error monitoring: ${sentryEnabled ? "on" : "off (set SENTRY_DSN)"}`);
  });
  // Railway sends SIGTERM on redeploy: finish in-flight requests, then go
  const shutdown = () => {
    server.close(() => { closeDb().catch(() => {}).finally(() => process.exit(0)); });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  // Node's own default for both of these is: print the stack and exit(1).
  // Report to Sentry first, but keep that same behavior — this app has no
  // reason to believe process state is still sound once one of these fires.
  process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", err);
    captureFatal(err).finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (err) => {
    console.error("unhandledRejection:", err);
    captureFatal(err).finally(() => process.exit(1));
  });
  return server;
}

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((err) => {
    console.error("startup failed:", err.message);
    process.exit(1);
  });
}
