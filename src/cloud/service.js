// The phone's side of the cloud-link service in server/index.js.
//
// Two modes, decided by the server:
//   accounts — the link belongs to the signed-in user and lives in the
//              database; the phone just asks for a token.
//   local    — the phone holds a sealed blob it can't read and trades it
//              for a token each time.
// With no service configured at all, everything here reports "not linked"
// and the older in-browser MSAL / Google flows in msGraph.js and
// googleDrive.js carry on exactly as before.
import { loadCloudLink, saveCloudLink, clearCloudLink } from "../storage.js";

const LABEL = { onedrive: "OneDrive", google: "Google Drive" };
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let configPromise = null;
export function cloudServiceConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((c) => ({
        mode: c.mode === "accounts" ? "accounts" : "local",
        onedrive: !!(c.providers ? c.providers.onedrive : c.onedrive),
        google: !!(c.providers ? c.providers.google : c.google),
        email: !!c.email,
      }));
  }
  return configPromise;
}

// accounts mode keeps the user's links here once /api/me has been read
let accountLinks = null; // [{provider, account}] or null when unknown
export function setAccountLinks(links) { accountLinks = links ? [...links] : null; }

export async function linkedAccount(provider) {
  const cfg = await cloudServiceConfig();
  if (cfg.mode === "accounts") {
    const l = (accountLinks || []).find((x) => x.provider === provider);
    return l ? { account: l.account || "" } : null;
  }
  const link = await loadCloudLink(provider);
  return link && link.blob ? { account: link.account || "" } : null;
}

// `win` is a window the caller opened synchronously in the tap handler —
// opening it after the fetch below would trip Safari's popup blocker. When
// there is none, the current tab navigates and comes back via ?cloudpair=.
export async function beginLink(provider, win) {
  const r = await fetch("/api/cloud/pair", json({ provider }));
  if (r.status === 401) throw new Error("You've been signed out — sign in again.");
  if (!r.ok) throw new Error(`This deployment isn't set up for ${LABEL[provider] || provider} yet.`);
  const { pair, url } = await r.json();
  if (win) win.location.href = url; else { window.location.assign(url); return null; }

  const deadline = Date.now() + 10 * 60 * 1000;
  let closedPolls = 0;
  while (Date.now() < deadline) {
    await sleep(1500);
    const c = await fetch(`/api/cloud/claim?pair=${encodeURIComponent(pair)}`, { cache: "no-store" });
    if (c.status === 404) throw new Error("The sign-in link expired — tap Connect again.");
    const j = await c.json();
    if (j.status === "done") {
      await recordLink(provider, j);
      try { win.close(); } catch { /* may already be gone */ }
      return j.account || "";
    }
    // the sign-in window was closed without finishing — give the callback a
    // moment to land, then stop waiting
    if (win.closed && ++closedPolls > 2) throw new Error("The sign-in was closed before it finished.");
  }
  throw new Error("Timed out waiting for the sign-in.");
}

async function recordLink(provider, j) {
  const cfg = await cloudServiceConfig();
  if (cfg.mode === "accounts") {
    accountLinks = [...(accountLinks || []).filter((x) => x.provider !== provider), { provider, account: j.account || "" }];
  } else if (j.blob) {
    await saveCloudLink(provider, { blob: j.blob, account: j.account || "" });
  }
  delete cache[provider];
}

// The callback page links back here with ?cloudpair= for the same-tab case;
// called once on boot. Returns what happened so the app can react (a
// sign-in means "reload who I am").
export async function claimFromUrl() {
  let pair;
  try {
    const u = new URL(window.location.href);
    pair = u.searchParams.get("cloudpair");
    if (!pair) return null;
    u.searchParams.delete("cloudpair");
    window.history.replaceState(null, "", u.pathname + u.search + u.hash);
  } catch { return null; }
  try {
    const c = await fetch(`/api/cloud/claim?pair=${encodeURIComponent(pair)}`, { cache: "no-store" });
    if (!c.ok) return null;
    const j = await c.json();
    if (j.status !== "done" || !j.provider) return null;
    if (j.purpose !== "signin") await recordLink(j.provider, j);
    return { purpose: j.purpose || "link", provider: j.provider, label: LABEL[j.provider] || j.provider, account: j.account || "" };
  } catch { return null; }
}

const cache = {}; // provider -> { token, exp }

// null when this phone isn't linked through the service (callers fall back
// to their in-browser flow); throws when it is linked but can't get a token.
export async function serviceToken(provider) {
  const cfg = await cloudServiceConfig();
  const c = cache[provider];
  if (c && c.exp > Date.now() + 60 * 1000) return c.token;

  let r;
  if (cfg.mode === "accounts") {
    if (!cfg[provider]) return null;
    r = await fetch("/api/cloud/token", json({ provider }));
    if (r.status === 404) return null; // not linked (or provider off)
  } else {
    const link = await loadCloudLink(provider);
    if (!link || !link.blob) return null;
    r = await fetch("/api/cloud/token", json({ blob: link.blob }));
  }
  if (r.status === 401) {
    delete cache[provider];
    if (cfg.mode === "accounts") {
      accountLinks = (accountLinks || []).filter((x) => x.provider !== provider);
      throw new Error(`${LABEL[provider]} needs connecting again — open Settings and tap Connect.`);
    }
    await clearCloudLink(provider);
    throw new Error(`${LABEL[provider]} needs connecting again — open Settings and tap Connect.`);
  }
  if (!r.ok) throw new Error(`Couldn't reach the cloud link service (${r.status}).`);
  const j = await r.json();
  if (j.blob) await saveCloudLink(provider, { blob: j.blob, account: j.account || "" });
  cache[provider] = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

export async function unlink(provider) {
  const cfg = await cloudServiceConfig();
  delete cache[provider];
  if (cfg.mode === "accounts") {
    accountLinks = (accountLinks || []).filter((x) => x.provider !== provider);
    try { await fetch(`/api/cloud/link/${provider}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }); } catch { /* best effort */ }
    return;
  }
  const link = await loadCloudLink(provider);
  await clearCloudLink(provider);
  if (link && link.blob) {
    try { await fetch("/api/cloud/revoke", json({ blob: link.blob })); } catch { /* best effort */ }
  }
}
