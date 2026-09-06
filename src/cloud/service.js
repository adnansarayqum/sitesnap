// The phone's side of the cloud-link service in server/index.js.
//
// After a one-time sign-in the phone holds a sealed blob it can't read; every
// upload trades it for a fresh access token. If the deployment has no
// service configured (no TOKEN_KEY / secrets on the server), every function
// here reports "not linked" and the older in-browser MSAL / Google flows in
// msGraph.js and googleDrive.js carry on exactly as before.
import { loadCloudLink, saveCloudLink, clearCloudLink } from "../storage.js";

const LABEL = { onedrive: "OneDrive", google: "Google Drive" };
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let configPromise = null;
export function cloudServiceConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/cloud/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((c) => ({ onedrive: !!c.onedrive, google: !!c.google }));
  }
  return configPromise;
}

export async function linkedAccount(provider) {
  const link = await loadCloudLink(provider);
  return link && link.blob ? { account: link.account || "" } : null;
}

// `win` is a window the caller opened synchronously in the tap handler —
// opening it after the fetch below would trip Safari's popup blocker. When
// there is none, the current tab navigates and comes back via ?cloudpair=.
export async function beginLink(provider, win) {
  const r = await fetch("/api/cloud/pair", json({ provider }));
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
      await saveCloudLink(provider, { blob: j.blob, account: j.account || "" });
      try { win.close(); } catch { /* may already be gone */ }
      return j.account || "";
    }
    // the sign-in window was closed without finishing — give the callback a
    // moment to land, then stop waiting
    if (win.closed && ++closedPolls > 2) throw new Error("The sign-in was closed before it finished.");
  }
  throw new Error("Timed out waiting for the sign-in.");
}

// The callback page links back here with ?cloudpair= for the same-tab case;
// called once on boot.
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
    await saveCloudLink(j.provider, { blob: j.blob, account: j.account || "" });
    return { provider: j.provider, label: LABEL[j.provider] || j.provider, account: j.account || "" };
  } catch { return null; }
}

const cache = {}; // provider -> { token, exp }

// null when this phone isn't linked through the service (callers fall back
// to their in-browser flow); throws when it is linked but can't get a token.
export async function serviceToken(provider) {
  const link = await loadCloudLink(provider);
  if (!link || !link.blob) return null;
  const c = cache[provider];
  if (c && c.exp > Date.now() + 60 * 1000) return c.token;
  const r = await fetch("/api/cloud/token", json({ blob: link.blob }));
  if (r.status === 401) {
    delete cache[provider];
    await clearCloudLink(provider);
    throw new Error(`${LABEL[provider]} needs connecting again — open Settings and tap Connect.`);
  }
  if (!r.ok) throw new Error(`Couldn't reach the cloud link service (${r.status}).`);
  const j = await r.json();
  if (j.blob) await saveCloudLink(provider, { blob: j.blob, account: j.account || link.account || "" });
  cache[provider] = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

export async function unlink(provider) {
  const link = await loadCloudLink(provider);
  delete cache[provider];
  await clearCloudLink(provider);
  if (link && link.blob) {
    try { await fetch("/api/cloud/revoke", json({ blob: link.blob })); } catch { /* best effort */ }
  }
}
