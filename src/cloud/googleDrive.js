// Direct-to-Google-Drive uploads — the same idea as msGraph.js but for
// surveyors who use Drive instead of OneDrive. Uses Google Identity
// Services' token client (Google's current recommendation for a
// browser-only app with no backend), scoped to drive.file so this app can
// only see files it created itself, not the surveyor's whole Drive.
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let gisLoaded = null;
let tokenClient = null;
let currentToken = null; // { access_token, expires_at }

function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve(window.google);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("Couldn't load Google's sign-in library"));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

function getTokenClient(clientId) {
  if (tokenClient && tokenClient.__clientId === clientId) return tokenClient;
  return null; // rebuilt lazily inside connect(), since it needs a callback closure
}

export function googleConnected() {
  return !!(currentToken && currentToken.expires_at > Date.now() + 30000);
}

export async function connectGoogleDrive(clientId) {
  const google = await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        currentToken = { access_token: resp.access_token, expires_at: Date.now() + (resp.expires_in || 3600) * 1000 };
        resolve(true);
      },
      error_callback: (err) => reject(new Error(err?.message || "Google sign-in was cancelled")),
    });
    client.__clientId = clientId;
    tokenClient = client;
    client.requestAccessToken({ prompt: currentToken ? "" : "consent" });
  });
}

export function disconnectGoogleDrive() {
  if (currentToken && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(currentToken.access_token); } catch { /* best effort */ }
  }
  currentToken = null;
  tokenClient = null;
}

async function getToken(clientId) {
  if (googleConnected()) return currentToken.access_token;
  // the access token is short-lived (~1h) and not persisted across reloads —
  // silently ask for a new one first; Google may still require a visible
  // prompt if there's no live session
  await connectGoogleDrive(clientId);
  return currentToken.access_token;
}

async function driveFetch(token, url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch { /* ignore */ }
    throw new Error(detail || `Google Drive request failed (${res.status})`);
  }
  return res.json();
}

const folderCache = new Map(); // "parentId/name" -> id, cleared per page load

async function findOrCreateFolder(token, name, parentId) {
  const key = `${parentId || "root"}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key);
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' ` +
    `and '${parentId || "root"}' in parents and trashed = false`
  );
  const found = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  let id;
  if (found.files && found.files.length) {
    id = found.files[0].id;
  } else {
    const created = await driveFetch(token, "https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined }),
    });
    id = created.id;
  }
  folderCache.set(key, id);
  return id;
}

async function resolveFolderPath(token, segments) {
  let parentId = null;
  for (const seg of segments) parentId = await findOrCreateFolder(token, seg, parentId);
  return parentId;
}

// `segments` is the folder path (e.g. ["Inspections", address, roomFolder]);
// `filename`/`file` are the leaf. Drive has no path-based upload like Graph,
// so the folders are found-or-created one level at a time, then cached for
// the rest of this upload run.
export async function uploadToGoogleDrive(clientId, segments, filename, file) {
  const token = await getToken(clientId);
  const parentId = await resolveFolderPath(token, segments);
  const metadata = { name: filename, parents: [parentId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch { /* ignore */ }
    throw new Error(detail || `Google Drive upload failed (${res.status})`);
  }
  return true;
}
