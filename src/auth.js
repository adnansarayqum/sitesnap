// The phone's side of accounts: who's signed in, which firm, and the calls
// that change that. Everything is a same-origin fetch carrying the session
// cookie; the app never sees a token.
import { cloudServiceConfig } from "./cloud/service.js";

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MESSAGES = {
  bad_email: "That doesn't look like an email address.",
  slow_down: "Too many attempts — wait a few minutes and try again.",
  email_failed: "The code couldn't be emailed. Try again in a moment.",
  expired: "That code has expired — request a new one.",
  too_many: "Too many wrong codes — request a new one.",
  wrong: "That code isn't right.",
  bad_name: "Give the firm a name of at least two characters.",
  invalid_or_wrong_email: "This invitation isn't valid, or it was sent to a different email address than the one you signed in with.",
  already_member: "They're already a member.",
  last_owner: "A firm must keep at least one owner.",
  owner_only: "Only an owner can change that.",
  admin_only: "Only an admin can do that.",
  sign_in: "You've been signed out — sign in again.",
};

async function call(method, url, body) {
  const r = await fetch(url, json(method, body));
  if (r.status === 401 && url !== "/api/auth/verify") window.dispatchEvent(new Event("ss:signed-out"));
  let data = {};
  try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) throw new Error(MESSAGES[data.error] || data.error || `Request failed (${r.status})`);
  return data;
}

// null when the server can't be reached at all (offline, or a static host
// with no backend): the app then behaves as local mode
export async function fetchMe() {
  try {
    const r = await fetch("/api/me", { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export const requestCode = (email) => call("POST", "/api/auth/code", { email });
export const verifyCode = (email, code, invite) => call("POST", "/api/auth/verify", { email, code, invite: invite || undefined });
export const signOut = () => call("POST", "/api/auth/signout", {});
export const updateName = (name) => call("PATCH", "/api/me", { name });
export const createOrg = (name) => call("POST", "/api/orgs", { name });
export const switchOrg = (org_id) => call("POST", "/api/session/org", { org_id });
export const renameOrg = (name) => call("PATCH", "/api/org", { name });
export const listMembers = () => call("GET", "/api/org/members");
export const setMemberRole = (userId, role) => call("PATCH", `/api/org/members/${userId}`, { role });
export const removeMember = (userId) => call("DELETE", `/api/org/members/${userId}`);
export const listInvites = () => call("GET", "/api/org/invites");
export const sendInvite = (email, role) => call("POST", "/api/org/invites", { email, role });
export const cancelInvite = (id) => call("DELETE", `/api/org/invites/${id}`);
export const acceptInvite = (token) => call("POST", "/api/invites/accept", { token });

export async function inviteInfo(token) {
  try { const r = await fetch(`/api/invites/${encodeURIComponent(token)}`); return r.ok ? await r.json() : null; } catch { return null; }
}

// an invite link opened on the phone carries ?invite=; keep it until the
// person has signed in, then accept it
const INVITE_KEY = "sitesnap:pendingInvite";
export function captureInviteFromUrl() {
  try {
    const u = new URL(window.location.href);
    const t = u.searchParams.get("invite");
    if (t) {
      localStorage.setItem(INVITE_KEY, t);
      u.searchParams.delete("invite");
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
    return localStorage.getItem(INVITE_KEY) || null;
  } catch { return null; }
}
export function clearPendingInvite() { try { localStorage.removeItem(INVITE_KEY); } catch { /* ignore */ } }

// Sign in with Microsoft / Google through the same pairing the drive link
// uses; the session cookie is set on the claim response, so it lands in
// this browser whichever one the provider's callback opened in.
export async function oauthSignIn(provider, win) {
  const { pair, url } = await call("POST", "/api/auth/oauth/pair", { provider });
  if (win) win.location.href = url; else { window.location.assign(url); return null; }
  const deadline = Date.now() + 10 * 60 * 1000;
  let closedPolls = 0;
  while (Date.now() < deadline) {
    await sleep(1500);
    const c = await fetch(`/api/cloud/claim?pair=${encodeURIComponent(pair)}`, { cache: "no-store" });
    if (c.status === 404) throw new Error("The sign-in link expired — try again.");
    const j = await c.json();
    if (j.status === "done") {
      try { win.close(); } catch { /* may already be gone */ }
      return j.account || "";
    }
    if (win.closed && ++closedPolls > 2) throw new Error("The sign-in was closed before it finished.");
  }
  throw new Error("Timed out waiting for the sign-in.");
}

export { cloudServiceConfig };
