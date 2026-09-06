// SiteSnap's small backend. Two jobs:
//
//   1. Serve the built app (what `serve -s dist` used to do).
//   2. Turn a one-time OneDrive / Google Drive sign-in into a connection
//      that lasts — which a browser-only app can't have: Microsoft caps a
//      SPA's refresh token at 24 hours and Google won't issue one at all.
//      As a confidential client (it holds the client secrets) this gets the
//      long-lived kind.
//
// There is deliberately no database. The refresh token is sealed with a key
// only this server knows and handed to the phone, which stores the sealed
// blob and presents it whenever it needs an access token. Nothing here
// survives a restart except the environment: lose TOKEN_KEY and every phone
// simply has to connect again. See docs/frictionless-cloud-link.md.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
// storage, and the callback can land in either.
const pending = new Map(); // pair -> { created, provider, result? }
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

// a label for the account, from the id_token both providers return when
// `openid email` is in the scope — display only, never used as identity
function accountFrom(tok) {
  try {
    const payload = JSON.parse(Buffer.from(String(tok.id_token).split(".")[1], "base64url").toString("utf8"));
    return payload.email || payload.preferred_username || payload.upn || payload.name || "";
  } catch { return ""; }
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

// ---- app -----------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));

app.get("/api/cloud/config", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ onedrive: enabled("onedrive"), google: enabled("google") });
});

app.post("/api/cloud/pair", (req, res) => {
  const provider = String((req.body && req.body.provider) || "");
  if (!enabled(provider)) return res.status(404).json({ error: "provider not configured" });
  sweep();
  const pair = crypto.randomBytes(16).toString("base64url");
  pending.set(pair, { created: Date.now(), provider });
  res.set("Cache-Control", "no-store");
  res.json({ pair, url: `${baseUrl(req)}/auth/${provider}/start?pair=${pair}` });
});

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

app.get("/auth/:provider/callback", async (req, res) => {
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
  try {
    const tok = await exchange(provider, {
      grant_type: "authorization_code",
      code: String(req.query.code || ""),
      redirect_uri: `${baseUrl(req)}/auth/${provider}/callback`,
      scope: PROVIDERS[provider].scope,
    });
    if (!tok.refresh_token) throw new Error("The sign-in didn't include a lasting token — for Google, remove SiteSnap's access at myaccount.google.com/permissions and try again.");
    const account = accountFrom(tok);
    p.result = { blob: seal({ v: 1, p: provider, rt: tok.refresh_token, acct: account, iat: Date.now() }), account };
    res.send(page(`${PROVIDERS[provider].label} connected${account ? " as " + account : ""}`,
      "SiteSnap has already picked this up — you can close this.", `${baseUrl(req)}/?cloudpair=${encodeURIComponent(pair)}`));
  } catch (e) {
    pending.delete(pair);
    res.status(502).send(page("Couldn't finish connecting", e.message, baseUrl(req)));
  }
});

app.get("/api/cloud/claim", (req, res) => {
  res.set("Cache-Control", "no-store");
  const pair = String(req.query.pair || "");
  const p = pending.get(pair);
  if (!p) return res.status(404).json({ status: "expired" });
  if (!p.result) return res.json({ status: "pending" });
  pending.delete(pair);
  res.json({ status: "done", provider: p.provider, ...p.result });
});

app.post("/api/cloud/token", async (req, res) => {
  res.set("Cache-Control", "no-store");
  let inner;
  try { inner = unseal(req.body && req.body.blob); } catch { return res.status(401).json({ error: "reconnect" }); }
  const provider = inner.p;
  if (!enabled(provider)) return res.status(404).json({ error: "provider not configured" });
  try {
    const tok = await exchange(provider, { grant_type: "refresh_token", refresh_token: inner.rt, scope: PROVIDERS[provider].scope });
    const out = { access_token: tok.access_token, expires_in: tok.expires_in || 3600, account: inner.acct || "" };
    // Microsoft rotates the refresh token on every use — hand the phone the
    // re-sealed one so the connection keeps sliding forward
    if (tok.refresh_token && tok.refresh_token !== inner.rt) out.blob = seal({ ...inner, rt: tok.refresh_token, iat: Date.now() });
    res.json(out);
  } catch (e) {
    if (e.code === "invalid_grant") return res.status(401).json({ error: "reconnect" });
    res.status(502).json({ error: e.message });
  }
});

app.post("/api/cloud/revoke", async (req, res) => {
  let inner;
  try { inner = unseal(req.body && req.body.blob); } catch { return res.json({ ok: true }); }
  const c = PROVIDERS[inner.p];
  if (c && c.revokeUrl) {
    try { await fetch(`${c.revokeUrl}?token=${encodeURIComponent(inner.rt)}`, { method: "POST" }); } catch { /* best effort */ }
  }
  res.json({ ok: true });
});

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

app.listen(PORT, "0.0.0.0", () => {
  const on = Object.keys(PROVIDERS).filter(enabled);
  console.log(`SiteSnap on :${PORT} — cloud link: ${on.length ? on.join(", ") : "off (set TOKEN_KEY plus a provider's client ID and secret)"}`);
});
