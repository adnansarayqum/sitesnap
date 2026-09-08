// Direct-to-OneDrive uploads via Microsoft Graph — no Make.com in between.
// Uses MSAL Browser's PKCE flow (public client, no secret needed for a
// static PWA) so a surveyor can sign in with their own Microsoft account
// and Graph writes straight into their OneDrive.
//
// Scoped to the app's own OneDrive folder (Files.ReadWrite.AppFolder), not
// the whole drive — SiteSnap physically cannot see or touch anything
// outside "Apps/SiteSnap" in the account it's connected to, which matters
// given the case files living there (tenant names, addresses, disrepair
// evidence). The trade-off: a surveyor browsing their own OneDrive finds
// inspections under Apps/SiteSnap/Inspections, not at the drive's root.
import { PublicClientApplication } from "@azure/msal-browser";
import { serviceToken } from "./service.js";

const SCOPES = ["Files.ReadWrite.AppFolder", "User.Read"];

let msalInstance = null;
let initPromise = null;

function getMsal(clientId) {
  if (msalInstance && msalInstance.__clientId === clientId) return initPromise;
  const pca = new PublicClientApplication({
    auth: {
      clientId,
      // "common" accepts both personal Microsoft accounts (OneDrive) and
      // work/school accounts (OneDrive for Business), so this works
      // whichever kind of Microsoft account the surveyor signs in with.
      authority: "https://login.microsoftonline.com/common",
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: "localStorage" }, // survives closing the PWA
  });
  msalInstance = pca;
  msalInstance.__clientId = clientId;
  initPromise = pca.initialize().then(() => pca);
  return initPromise;
}

export async function msAccount(clientId) {
  if (!clientId) return null;
  try {
    const pca = await getMsal(clientId);
    const accounts = pca.getAllAccounts();
    return accounts[0] || null;
  } catch { return null; }
}

export async function connectOneDrive(clientId) {
  const pca = await getMsal(clientId);
  const res = await pca.loginPopup({ scopes: SCOPES });
  return res.account;
}

export async function disconnectOneDrive(clientId) {
  if (!clientId) return;
  try {
    const pca = await getMsal(clientId);
    const account = pca.getAllAccounts()[0];
    if (account) await pca.logoutPopup({ account });
  } catch { /* best effort */ }
}

async function getToken(clientId) {
  // linked through the server-side service: no MSAL, no popups, ever
  const svc = await serviceToken("onedrive");
  if (svc) return svc;
  if (!clientId) throw new Error("Not connected to OneDrive");
  const pca = await getMsal(clientId);
  const account = pca.getAllAccounts()[0];
  if (!account) throw new Error("Not connected to OneDrive");
  try {
    const res = await pca.acquireTokenSilent({ scopes: SCOPES, account });
    return res.accessToken;
  } catch {
    // silent refresh failed (token expired and no valid session) — ask again
    const res = await pca.acquireTokenPopup({ scopes: SCOPES, account });
    return res.accessToken;
  }
}

function graphPathFor(segments) {
  // Graph builds/creates the folder path automatically from a colon-path,
  // same layout Make already produces: Inspections/<address>/<folder>/<file>
  // — relative to the app folder (see uploadToOneDrive), not the drive root
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

// Simple upload (<4MB) — SiteSnap already compresses everything sent to the
// cloud to well under that, so no resumable upload session is needed.
export async function uploadToOneDrive(clientId, segments, file) {
  const token = await getToken(clientId);
  const path = graphPathFor(segments);
  // special/approot, not drive/root — confines every write to the app's own
  // isolated OneDrive folder, matching the AppFolder scope above
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${path}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch { /* ignore */ }
    throw new Error(detail || `OneDrive upload failed (${res.status})`);
  }
  return true;
}
