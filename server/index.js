// SiteSnap's backend. Serves the built app and, depending on what's
// configured, runs in one of two modes:
//
//   local     — no DATABASE_URL. The app is the single-user PWA it always
//               was. If TOKEN_KEY and a provider's secrets are set, the
//               cloud-link service works statelessly: the refresh token is
//               sealed and kept on the phone (see docs/frictionless-cloud-link.md).
//
//   accounts  — DATABASE_URL set. Sign-in (email code, Microsoft, Google),
//               firms ("orgs") with roles and invitations, cloud links kept
//               per user so they follow them across devices, and the firm's
//               case register. Sessions are httpOnly cookies.
//
// Secrets never leave this process; the phone only ever holds a session
// cookie and, in local mode, a sealed blob it can't read.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasDb, migrate, closeDb, q, one, tx } from "./db.js";
import {
  attachSession, requireUser, requireOrg, requireAdmin, createSession, destroySession,
  clearSessionCookie, setSessionCookie, findOrCreateUser, issueCode, verifyCode,
  rateLimit, clientIp, normEmail, validEmail, randomToken, sha256, audit,
} from "./auth.js";
import { sendEmail, emailConfigured, signInCodeEmail, inviteEmail } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PORT = process.env.PORT || 3000;

const PROVIDERS = {
  onedrive: {
    label: "OneDrive",
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    // "common": personal Microsoft accounts and work/school accounts alike
    authUrl: process.env.MS_AUTH_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: process.env.MS_TOKEN_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revokeUrl: null, // Microsoft has no per-app revoke endpoint; the account's "apps you've given access to" page does it
    scope: "openid profile email offline_access Files.ReadWrite",
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
// TOKEN_KEY may be 64 hex chars or any passphrase; either way it becomes a
// 32-byte AES-256-GCM key. Without it no provider is enabled at all.
const KEY = (() => {
  const raw = process.env.TOKEN_KEY || "";
  if (!raw) return null;
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw).digest();
})();

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
const pending = new Map(); // pair -> { created, provider, purpose, userId?, result? }
const PAIR_TTL_MS = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.created > PAIR_TTL_MS) pending.delete(k);
}
setInterval(sweep, 60 * 1000).unref();

// the OAuth `state` is the pair code plus an HMAC, so a callback can only
// ever complete the pairing it was started for
const sign = (pair) => crypto.createHmac("sha256", KEY).update(pair).digest("base64url").slice(0, 22);

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return `${proto}://${req.get("host")}`;
}

function newPair(provider, purpose, userId) {
  sweep();
  const pair = crypto.randomBytes(16).toString("base64url");
  pending.set(pair, { created: Date.now(), provider, purpose, userId: userId || null });
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

async function storeLink(userId, provider, refreshToken, account) {
  await q(`insert into cloud_links (user_id, provider, refresh_token_enc, account)
           values ($1, $2, $3, $4)
           on conflict (user_id, provider) do update set refresh_token_enc = excluded.refresh_token_enc, account = excluded.account, updated_at = now()`,
    [userId, provider, seal({ rt: refreshToken }), account || null]);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function page(title, text, backHref) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SiteSnap</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F6F6F3;color:#14201B;font:16px/1.5 system-ui,sans-serif}
main{max-width:360px;padding:32px 28px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#5E6B64;margin:0 0 20px}
a{display:inline-block;background:#10352A;color:#fff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 22px}</style>
<main><h1>${esc(title)}</h1><p>${esc(text)}</p>${backHref ? `<a href="${esc(backHref)}">Back to SiteSnap</a>` : ""}</main>`;
}

// ---- "me": what the app needs to know about the signed-in person ---------
async function me(req) {
  const base = { mode: hasDb ? "accounts" : "local", providers: { onedrive: enabled("onedrive"), google: enabled("google") }, email: emailConfigured };
  if (!hasDb || !req.session) return { ...base, user: null };
  const user = await one("select id, email, name, created_at from users where id = $1", [req.session.user_id]);
  if (!user) return { ...base, user: null };
  const orgs = (await q(`select o.id, o.name, m.role from memberships m join orgs o on o.id = m.org_id where m.user_id = $1 order by o.name`, [user.id])).rows;
  const org = req.membership ? { id: req.membership.org_id, name: req.membership.org_name, role: req.membership.role } : null;
  const links = (await q("select provider, account from cloud_links where user_id = $1", [user.id])).rows;
  return { ...base, user, org, orgs, links };
}

// ---- app -----------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set("X-Frame-Options", "DENY");
  res.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  next();
});
app.use(express.json({ limit: "4mb" }));
// every mutating API call is JSON from our own page; a cross-site form
// post can't set that content type, and SameSite=Lax keeps the cookie
// off cross-site posts anyway. DELETE carries no body and can't be sent
// by a form at all (a cross-site fetch DELETE needs a CORS preflight).
app.use("/api", (req, res, next) => {
  const mutating = !["GET", "HEAD", "DELETE"].includes(req.method);
  if (mutating && !req.is("application/json")) return res.status(415).json({ error: "json_only" });
  res.set("Cache-Control", "no-store");
  next();
});
if (hasDb) app.use(attachSession);
else app.use((req, res, next) => { req.session = null; req.membership = null; next(); });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/healthz", wrap(async (req, res) => {
  let dbOk = null;
  if (hasDb) { try { await q("select 1"); dbOk = true; } catch { dbOk = false; } }
  res.status(dbOk === false ? 503 : 200).json({ ok: dbOk !== false, mode: hasDb ? "accounts" : "local", db: dbOk });
}));

app.get("/api/config", wrap(async (req, res) => {
  res.json({ mode: hasDb ? "accounts" : "local", providers: { onedrive: enabled("onedrive"), google: enabled("google") }, email: emailConfigured });
}));
// older clients
app.get("/api/cloud/config", (req, res) => res.json({ onedrive: enabled("onedrive"), google: enabled("google") }));

app.get("/api/me", wrap(async (req, res) => res.json(await me(req))));

// ---- sign-in --------------------------------------------------------------
if (hasDb) {
  app.post("/api/auth/code", wrap(async (req, res) => {
    const email = normEmail(req.body && req.body.email);
    if (!validEmail(email)) return res.status(400).json({ error: "bad_email" });
    if (!rateLimit(`code:ip:${clientIp(req)}`, 20, 10 * 60 * 1000) || !rateLimit(`code:email:${email}`, 3, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "slow_down" });
    }
    const code = await issueCode(email);
    try { await sendEmail({ to: email, ...signInCodeEmail(code) }); }
    catch (e) { console.error("sign-in email failed:", e.message); return res.status(502).json({ error: "email_failed" }); }
    res.json({ ok: true, delivery: emailConfigured ? "email" : "log" });
  }));

  app.post("/api/auth/verify", wrap(async (req, res) => {
    const email = normEmail(req.body && req.body.email);
    if (!validEmail(email)) return res.status(400).json({ error: "bad_email" });
    if (!rateLimit(`verify:ip:${clientIp(req)}`, 30, 10 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
    const v = await verifyCode(email, req.body.code);
    if (!v.ok) return res.status(401).json({ error: v.reason });
    const user = await findOrCreateUser(email, null);
    await createSession(req, res, user.id);
    req.session = { user_id: user.id, org_id: null };
    await acceptInviteIfAny(req, user, req.body.invite);
    await reloadSession(req);
    res.json(await me(req));
  }));

  app.post("/api/auth/signout", wrap(async (req, res) => {
    await destroySession(req);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  }));

  app.patch("/api/me", requireUser, wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || "").trim().slice(0, 80);
    await q("update users set name = $2 where id = $1", [req.session.user_id, name || null]);
    res.json(await me(req));
  }));

  // sign in with Microsoft / Google — no session needed to start
  app.post("/api/auth/oauth/pair", wrap(async (req, res) => {
    const provider = String((req.body && req.body.provider) || "");
    if (!enabled(provider)) return res.status(404).json({ error: "provider not configured" });
    if (!rateLimit(`oauth:ip:${clientIp(req)}`, 30, 10 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
    const pair = newPair(provider, "signin");
    res.json({ pair, url: `${baseUrl(req)}/auth/${provider}/start?pair=${pair}` });
  }));
}

// after a session exists on req: apply a pending invitation the phone
// carried in from an invite link, if it's addressed to this person
async function acceptInviteIfAny(req, user, token) {
  if (!token) return null;
  const inv = await one("select * from invites where token_hash = $1 and accepted_at is null and expires_at > now()", [sha256(token)]);
  if (!inv || normEmail(inv.email) !== normEmail(user.email)) return null;
  await tx(async (c) => {
    await c.query(`insert into memberships (org_id, user_id, role) values ($1, $2, $3)
                   on conflict (org_id, user_id) do update set role = excluded.role`, [inv.org_id, user.id, inv.role]);
    await c.query("update invites set accepted_at = now() where id = $1", [inv.id]);
    await c.query("update sessions set org_id = $2 where user_id = $1", [user.id, inv.org_id]);
  });
  await audit({ session: { org_id: inv.org_id, user_id: user.id } }, "invite.accepted", inv.email, { role: inv.role });
  return inv;
}

async function reloadSession(req) {
  const fresh = await one("select * from sessions where user_id = $1 order by created_at desc limit 1", [req.session.user_id]);
  req.session = fresh || req.session;
  req.membership = req.session.org_id
    ? await one("select m.*, o.name as org_name from memberships m join orgs o on o.id = m.org_id where m.org_id = $1 and m.user_id = $2", [req.session.org_id, req.session.user_id])
    : null;
}

// ---- cloud link pairing (works in both modes) -----------------------------
app.post("/api/cloud/pair", wrap(async (req, res) => {
  const provider = String((req.body && req.body.provider) || "");
  if (!enabled(provider)) return res.status(404).json({ error: "provider not configured" });
  if (hasDb && !req.session) return res.status(401).json({ error: "sign_in" });
  const pair = newPair(provider, "link", req.session && req.session.user_id);
  res.json({ pair, url: `${baseUrl(req)}/auth/${provider}/start?pair=${pair}` });
}));

app.get("/auth/:provider/start", (req, res) => {
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
  if (!enabled(provider) || !p || p.provider !== provider || sig !== sign(pair)) {
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

    if (p.purpose === "signin") {
      if (!who.email) throw new Error(`Your ${provider === "google" ? "Google" : "Microsoft"} account didn't share an email address, which SiteSnap needs to know who you are.`);
      const user = await findOrCreateUser(who.email, who.name);
      await storeLink(user.id, provider, tok.refresh_token, who.label);
      const token = await createSession(req, null, user.id);
      setSessionCookie(req, res, token); // same-browser case gets it straight away too
      p.result = { session: token, account: who.label };
      await audit({ session: { user_id: user.id, org_id: null } }, "signin", provider);
      return res.send(page(`Signed in as ${who.label}`, "SiteSnap has already picked this up — you can close this.", back));
    }

    if (hasDb) {
      // accounts mode: the link belongs to the person who started the pairing
      await storeLink(p.userId, provider, tok.refresh_token, who.label);
      p.result = { account: who.label };
    } else {
      p.result = { blob: seal({ v: 1, p: provider, rt: tok.refresh_token, acct: who.label, iat: Date.now() }), account: who.label };
    }
    res.send(page(`${label} connected${who.label ? " as " + who.label : ""}`, "SiteSnap has already picked this up — you can close this.", back));
  } catch (e) {
    pending.delete(pair);
    res.status(502).send(page("Couldn't finish connecting", e.message, baseUrl(req)));
  }
}));

// polled by the phone; for a sign-in pairing this is also where the
// session cookie lands in the right browser
app.get("/api/cloud/claim", wrap(async (req, res) => {
  const pair = String(req.query.pair || "");
  const p = pending.get(pair);
  if (!p) return res.status(404).json({ status: "expired" });
  if (!p.result) return res.json({ status: "pending" });
  pending.delete(pair);
  if (p.purpose === "signin") {
    setSessionCookie(req, res, p.result.session);
    return res.json({ status: "done", purpose: "signin", provider: p.provider, account: p.result.account });
  }
  res.json({ status: "done", purpose: "link", provider: p.provider, ...p.result });
}));

app.post("/api/cloud/token", wrap(async (req, res) => {
  // a runaway client must not hammer Microsoft or Google with refreshes
  if (!rateLimit(`token:${req.session ? req.session.user_id : clientIp(req)}`, 120, 10 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
  if (hasDb) {
    if (!req.session) return res.status(401).json({ error: "sign_in" });
    const provider = String((req.body && req.body.provider) || "");
    if (!enabled(provider)) return res.status(404).json({ error: "provider not configured" });
    const link = await one("select * from cloud_links where user_id = $1 and provider = $2", [req.session.user_id, provider]);
    if (!link) return res.status(404).json({ error: "not_linked" });
    let inner;
    try { inner = unseal(link.refresh_token_enc); } catch { return res.status(401).json({ error: "reconnect" }); }
    try {
      const tok = await refreshAccess(provider, inner.rt);
      if (tok.refresh_token && tok.refresh_token !== inner.rt) {
        await q("update cloud_links set refresh_token_enc = $3, updated_at = now() where user_id = $1 and provider = $2",
          [req.session.user_id, provider, seal({ rt: tok.refresh_token })]);
      }
      return res.json({ access_token: tok.access_token, expires_in: tok.expires_in || 3600, account: link.account || "" });
    } catch (e) {
      if (e.code === "invalid_grant") {
        await q("delete from cloud_links where user_id = $1 and provider = $2", [req.session.user_id, provider]);
        return res.status(401).json({ error: "reconnect" });
      }
      return res.status(502).json({ error: e.message });
    }
  }
  // local mode: the sealed blob is the credential
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

if (hasDb) {
  app.delete("/api/cloud/link/:provider", requireUser, wrap(async (req, res) => {
    const { provider } = req.params;
    const link = await one("select * from cloud_links where user_id = $1 and provider = $2", [req.session.user_id, provider]);
    if (link) {
      try { await revokeAtProvider(provider, unseal(link.refresh_token_enc).rt); } catch { /* best effort */ }
      await q("delete from cloud_links where user_id = $1 and provider = $2", [req.session.user_id, provider]);
    }
    res.json({ ok: true });
  }));

  // ---- firms -----------------------------------------------------------------
  app.post("/api/orgs", requireUser, wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || "").trim().slice(0, 120);
    if (name.length < 2) return res.status(400).json({ error: "bad_name" });
    const org = await tx(async (c) => {
      const o = (await c.query("insert into orgs (name) values ($1) returning *", [name])).rows[0];
      await c.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [o.id, req.session.user_id]);
      await c.query("insert into org_counters (org_id) values ($1)", [o.id]);
      await c.query("update sessions set org_id = $2 where id = $1", [req.session.id, o.id]);
      return o;
    });
    await audit({ session: { org_id: org.id, user_id: req.session.user_id } }, "org.created", org.name);
    await reloadSession(req);
    res.json(await me(req));
  }));

  app.post("/api/session/org", requireUser, wrap(async (req, res) => {
    const orgId = String((req.body && req.body.org_id) || "");
    const m = await one("select 1 from memberships where org_id = $1 and user_id = $2", [orgId, req.session.user_id]);
    if (!m) return res.status(403).json({ error: "not_a_member" });
    await q("update sessions set org_id = $2 where id = $1", [req.session.id, orgId]);
    await reloadSession(req);
    res.json(await me(req));
  }));

  app.patch("/api/org", requireAdmin, wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || "").trim().slice(0, 120);
    if (name.length < 2) return res.status(400).json({ error: "bad_name" });
    await q("update orgs set name = $2 where id = $1", [req.session.org_id, name]);
    await audit(req, "org.renamed", name);
    await reloadSession(req);
    res.json(await me(req));
  }));

  app.get("/api/org/members", requireOrg, wrap(async (req, res) => {
    const rows = (await q(`select u.id, u.email, u.name, m.role, m.created_at, u.last_seen_at
                           from memberships m join users u on u.id = m.user_id
                           where m.org_id = $1 order by m.role = 'owner' desc, m.role = 'admin' desc, lower(coalesce(u.name, u.email))`,
      [req.session.org_id])).rows;
    res.json({ members: rows });
  }));

  app.patch("/api/org/members/:userId", requireAdmin, wrap(async (req, res) => {
    const role = String((req.body && req.body.role) || "");
    if (!["owner", "admin", "surveyor"].includes(role)) return res.status(400).json({ error: "bad_role" });
    const target = await one("select * from memberships where org_id = $1 and user_id = $2", [req.session.org_id, req.params.userId]);
    if (!target) return res.status(404).json({ error: "not_found" });
    // only an owner hands out or takes away ownership
    if ((role === "owner" || target.role === "owner") && req.membership.role !== "owner") return res.status(403).json({ error: "owner_only" });
    if (target.role === "owner" && role !== "owner") {
      const owners = await one("select count(*)::int as n from memberships where org_id = $1 and role = 'owner'", [req.session.org_id]);
      if (owners.n <= 1) return res.status(409).json({ error: "last_owner" });
    }
    await q("update memberships set role = $3 where org_id = $1 and user_id = $2", [req.session.org_id, req.params.userId, role]);
    await audit(req, "member.role", req.params.userId, { role });
    res.json({ ok: true });
  }));

  app.delete("/api/org/members/:userId", requireAdmin, wrap(async (req, res) => {
    const target = await one("select * from memberships where org_id = $1 and user_id = $2", [req.session.org_id, req.params.userId]);
    if (!target) return res.status(404).json({ error: "not_found" });
    if (target.role === "owner") {
      if (req.membership.role !== "owner") return res.status(403).json({ error: "owner_only" });
      const owners = await one("select count(*)::int as n from memberships where org_id = $1 and role = 'owner'", [req.session.org_id]);
      if (owners.n <= 1) return res.status(409).json({ error: "last_owner" });
    }
    await tx(async (c) => {
      await c.query("delete from memberships where org_id = $1 and user_id = $2", [req.session.org_id, req.params.userId]);
      // their sessions fall back to another firm they belong to, or none
      await c.query(`update sessions set org_id = (select org_id from memberships where user_id = $1 order by created_at desc limit 1)
                     where user_id = $1 and org_id = $2`, [req.params.userId, req.session.org_id]);
    });
    await audit(req, "member.removed", req.params.userId);
    res.json({ ok: true });
  }));

  // who did what in the firm — team changes, cases opened and removed
  app.get("/api/org/audit", requireAdmin, wrap(async (req, res) => {
    const rows = (await q(`select a.action, a.target, a.detail, a.at, coalesce(u.name, u.email) as who
                           from audit_log a left join users u on u.id = a.user_id
                           where a.org_id = $1 order by a.at desc limit 60`, [req.session.org_id])).rows;
    res.json({ events: rows });
  }));

  app.get("/api/org/invites", requireAdmin, wrap(async (req, res) => {
    const rows = (await q("select id, email, role, created_at, expires_at from invites where org_id = $1 and accepted_at is null and expires_at > now() order by created_at desc",
      [req.session.org_id])).rows;
    res.json({ invites: rows });
  }));

  app.post("/api/org/invites", requireAdmin, wrap(async (req, res) => {
    const email = normEmail(req.body && req.body.email);
    const role = String((req.body && req.body.role) || "surveyor");
    if (!validEmail(email)) return res.status(400).json({ error: "bad_email" });
    if (!["admin", "surveyor"].includes(role)) return res.status(400).json({ error: "bad_role" });
    if (!rateLimit(`invite:org:${req.session.org_id}`, 50, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
    const already = await one("select 1 from memberships m join users u on u.id = m.user_id where m.org_id = $1 and lower(u.email) = $2", [req.session.org_id, email]);
    if (already) return res.status(409).json({ error: "already_member" });
    const token = randomToken(24);
    const inv = await one(`insert into invites (org_id, email, role, token_hash, invited_by, expires_at)
                           values ($1, $2, $3, $4, $5, now() + interval '14 days') returning id, email, role, created_at, expires_at`,
      [req.session.org_id, email, role, sha256(token), req.session.user_id]);
    const link = `${baseUrl(req)}/?invite=${token}`;
    const inviter = await one("select name, email from users where id = $1", [req.session.user_id]);
    let delivered = false;
    try { await sendEmail({ to: email, ...inviteEmail({ orgName: req.membership.org_name, inviterName: inviter.name || inviter.email, link }) }); delivered = emailConfigured; }
    catch (e) { console.error("invite email failed:", e.message); }
    await audit(req, "invite.sent", email, { role });
    // the link is returned so an admin can hand it over directly (WhatsApp,
    // in person) when email isn't set up or didn't arrive
    res.json({ invite: inv, link, delivered });
  }));

  app.delete("/api/org/invites/:id", requireAdmin, wrap(async (req, res) => {
    await q("delete from invites where id = $1 and org_id = $2", [req.params.id, req.session.org_id]);
    res.json({ ok: true });
  }));

  // what an invite link is for — shown on the sign-in screen before signing in
  app.get("/api/invites/:token", wrap(async (req, res) => {
    const inv = await one(`select i.email, i.role, i.expires_at, o.name as org_name from invites i join orgs o on o.id = i.org_id
                           where i.token_hash = $1 and i.accepted_at is null and i.expires_at > now()`, [sha256(req.params.token)]);
    if (!inv) return res.status(404).json({ error: "invalid" });
    res.json({ org_name: inv.org_name, email: inv.email, role: inv.role });
  }));

  app.post("/api/invites/accept", requireUser, wrap(async (req, res) => {
    const user = await one("select * from users where id = $1", [req.session.user_id]);
    const inv = await acceptInviteIfAny(req, user, req.body && req.body.token);
    if (!inv) return res.status(404).json({ error: "invalid_or_wrong_email" });
    await reloadSession(req);
    res.json(await me(req));
  }));
}

// ---- the firm's case register ---------------------------------------------
// Everything about a case except the full-size photos: the phone pushes the
// record after every change (debounced) and the thumbnails it hasn't sent
// yet. Case numbers are handed out here, per firm, on first sync.
if (hasDb) {
  const CASE_ID = /^insp_[\w-]{4,60}$/;

  app.get("/api/cases", requireOrg, wrap(async (req, res) => {
    const status = ["open", "closed", "all"].includes(String(req.query.status)) ? String(req.query.status) : "all";
    const rows = (await q(`
      select c.id, c.case_no, c.address, c.postcode, c.status, c.started_at, c.closed_at, c.updated_at, c.created_by,
             c.doc->>'ref' as ref, coalesce(u.name, u.email) as created_by_name, c.doc->'lastUpload' as last_upload,
             (select count(*)::int from photos p where p.case_id = c.id) as photos,
             jsonb_array_length(coalesce(c.doc->'rooms', '[]'::jsonb)) as rooms
      from cases c left join users u on u.id = c.created_by
      where c.org_id = $1 and ($2 = 'all' or c.status = $2)
      order by c.updated_at desc limit 500`, [req.session.org_id, status])).rows;
    res.json({ cases: rows });
  }));

  app.get("/api/cases/:id", requireOrg, wrap(async (req, res) => {
    const c = await one(`select c.*, coalesce(u.name, u.email) as created_by_name from cases c
                         left join users u on u.id = c.created_by where c.id = $1 and c.org_id = $2`, [req.params.id, req.session.org_id]);
    if (!c) return res.status(404).json({ error: "not_found" });
    const photos = (await q("select id, room_id, no, caption, (thumb is not null) as has_thumb from photos where case_id = $1 order by no nulls last", [c.id])).rows;
    res.json({ case: { ...c, photos } });
  }));

  app.put("/api/cases/:id", requireOrg, wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!CASE_ID.test(id)) return res.status(400).json({ error: "bad_id" });
    const b = req.body || {};
    const doc = b.doc && typeof b.doc === "object" ? b.doc : {};
    const photos = Array.isArray(b.photos) ? b.photos.slice(0, 2000) : [];
    const status = b.status === "closed" ? "closed" : "open";
    const out = await tx(async (c) => {
      const existing = (await c.query("select org_id, case_no, created_by from cases where id = $1", [id])).rows[0];
      if (existing && existing.org_id !== req.session.org_id) { const e = new Error("forbidden"); e.status = 403; throw e; }
      let caseNo = existing ? existing.case_no : null;
      if (caseNo == null) {
        await c.query("insert into org_counters (org_id) values ($1) on conflict do nothing", [req.session.org_id]);
        const r = await c.query("update org_counters set next_case_no = next_case_no + 1 where org_id = $1 returning next_case_no - 1 as n", [req.session.org_id]);
        caseNo = r.rows[0].n;
      }
      await c.query(`insert into cases (id, org_id, created_by, case_no, address, postcode, status, started_at, closed_at, updated_at, doc)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
                     on conflict (id) do update set address = excluded.address, postcode = excluded.postcode, status = excluded.status,
                       started_at = excluded.started_at, closed_at = excluded.closed_at, updated_at = now(), doc = excluded.doc`,
        [id, req.session.org_id, existing ? existing.created_by : req.session.user_id, caseNo,
          String(b.address || "").slice(0, 300), String(b.postcode || "").slice(0, 20) || null, status,
          b.startedAt ? new Date(b.startedAt) : null, b.closedAt ? new Date(b.closedAt) : null, JSON.stringify(doc)]);
      const keep = photos.map((p) => String(p.id));
      await c.query("delete from photos where case_id = $1 and not (id = any($2::text[]))", [id, keep]);
      for (const p of photos) {
        await c.query(`insert into photos (id, case_id, room_id, no, caption) values ($1, $2, $3, $4, $5)
                       on conflict (id) do update set room_id = excluded.room_id, no = excluded.no, caption = excluded.caption`,
          [String(p.id), id, p.roomId ? String(p.roomId) : null, Number.isFinite(p.no) ? p.no : null, p.caption ? String(p.caption).slice(0, 500) : null]);
      }
      const missing = (await c.query("select id from photos where case_id = $1 and thumb is null", [id])).rows.map((r) => r.id);
      return { case_no: caseNo, missingThumbs: missing, created: !existing };
    });
    if (out.created) await audit(req, "case.created", id, { case_no: out.case_no });
    res.json({ case_no: out.case_no, missingThumbs: out.missingThumbs });
  }));

  app.post("/api/cases/:id/thumbs", requireOrg, wrap(async (req, res) => {
    const owned = await one("select 1 from cases where id = $1 and org_id = $2", [req.params.id, req.session.org_id]);
    if (!owned) return res.status(404).json({ error: "not_found" });
    const thumbs = Array.isArray(req.body && req.body.thumbs) ? req.body.thumbs.slice(0, 25) : [];
    let stored = 0;
    for (const t of thumbs) {
      const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(t.dataUrl || ""));
      if (!m) continue;
      const buf = Buffer.from(m[1], "base64");
      if (buf.length > 160 * 1024) continue; // a thumbnail, not the photo
      const r = await q("update photos set thumb = $3 where id = $1 and case_id = $2", [String(t.id), req.params.id, buf]);
      stored += r.rowCount;
    }
    res.json({ stored });
  }));

  app.get("/api/photos/:id/thumb", requireOrg, wrap(async (req, res) => {
    const p = await one("select p.thumb from photos p join cases c on c.id = p.case_id where p.id = $1 and c.org_id = $2", [req.params.id, req.session.org_id]);
    if (!p || !p.thumb) return res.status(404).end();
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "private, max-age=86400");
    res.send(p.thumb);
  }));

  // discarding on the phone removes the register copy too — it never happened
  app.delete("/api/cases/:id", requireOrg, wrap(async (req, res) => {
    const c = await one("select created_by from cases where id = $1 and org_id = $2", [req.params.id, req.session.org_id]);
    if (!c) return res.json({ ok: true });
    const admin = ["owner", "admin"].includes(req.membership.role);
    if (!admin && c.created_by !== req.session.user_id) return res.status(403).json({ error: "admin_only" });
    await q("delete from cases where id = $1", [req.params.id]);
    await audit(req, "case.deleted", req.params.id);
    res.json({ ok: true });
  }));
}

// ---- the app itself --------------------------------------------------------
app.use(express.static(DIST, {
  index: false,
  setHeaders(res, filePath) {
    // hashed bundles can be cached forever; everything else must revalidate
    // so a deploy is picked up on the next open
    res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache");
  },
}));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return res.status(404).json({ error: "not found" });
  res.sendFile(path.join(DIST, "index.html"), { headers: { "Cache-Control": "no-cache" } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.path}:`, err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err);
  if (res.headersSent) return;
  res.status(err && err.status ? err.status : 500).json({ error: err && err.status ? err.message : "server_error" });
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

(async () => {
  if (hasDb) {
    try { await migrate(); await purge(); setInterval(purge, 6 * 60 * 60 * 1000).unref(); }
    catch (e) { console.error("database unavailable:", e.message); process.exit(1); }
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    const on = Object.keys(PROVIDERS).filter(enabled);
    console.log(`SiteSnap on :${PORT} — mode: ${hasDb ? "accounts" : "local"}; cloud link: ${on.length ? on.join(", ") : "off (set TOKEN_KEY plus a provider's client ID and secret)"}; email: ${emailConfigured ? "resend" : "log only"}`);
  });
  // Railway sends SIGTERM on redeploy: finish in-flight requests, then go
  const shutdown = () => {
    server.close(() => { closeDb().catch(() => {}).finally(() => process.exit(0)); });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
