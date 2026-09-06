// IndexedDB persistence via idb-keyval — survives closing the browser,
// holds far more than localStorage (photos are big).
import { get, set, del, keys, delMany } from "idb-keyval";

// A failed write means a photo exists only in memory and dies on reload —
// the surveyor has left the property by then and cannot reshoot it. Callers
// register here so the UI can say so out loud instead of logging to a
// console nobody is watching.
let onWriteError = null;
export function setStorageErrorHandler(fn) { onWriteError = fn; }

function writeFailed(what, e) {
  console.error(what + " failed", e);
  const quota = e && (e.name === "QuotaExceededError" || e.name === "NotAllowedError");
  if (onWriteError) onWriteError({ what, quota, error: e });
}

// Ask the browser not to evict this data. Without it IndexedDB is
// "best effort" and can be cleared under disk pressure, taking a morning's
// inspection with it. Granted readily once the app is on the home screen.
export async function requestDurableStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

export async function storageEstimate() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) return null;
    return { usage, quota, freeMB: Math.round((quota - usage) / 1048576) };
  } catch { return null; }
}

const LEGACY_KEY = "sitesnap:inspection";   // pre-1.3: a single inspection
const INDEX_KEY = "sitesnap:inspections";   // [{id, address, postcode, startedAt}]
const HOOK_KEY = "sitesnap:webhook";
const KEY_KEY = "sitesnap:webhookKey";

const recordKey = (id) => `sitesnap:inspection:${id}`;

// Several properties can be open at once — a surveyor doing three in a day
// can't finish and wipe one before starting the next, and may be out of
// signal all morning.
export async function loadIndex() {
  try { return (await get(INDEX_KEY)) || []; } catch { return []; }
}

async function writeIndex(list) {
  try { await set(INDEX_KEY, list); } catch (e) { writeFailed("Saving the inspection list", e); }
}

// Every index update is read-modify-write. Two saves in flight at once (a
// note keystroke landing while a photo is still being written) would each
// read the same list and the second would silently undo the first, so they
// queue behind one another.
let indexQueue = Promise.resolve();
function withIndex(fn) {
  const run = indexQueue.then(fn, fn);
  indexQueue = run.catch(() => {});
  return run;
}

export async function loadInspection(id) {
  try { return (await get(recordKey(id))) || null; } catch { return null; }
}

export function saveState(inspection, rooms) {
  if (!inspection) return Promise.resolve();
  return withIndex(async () => {
    try {
      await set(recordKey(inspection.id), { inspection, rooms });
      const list = await loadIndex();
      const summary = {
        id: inspection.id,
        address: inspection.address,
        postcode: inspection.postcode || "",
        startedAt: inspection.startedAt,
        caseNo: inspection.caseNo || null,
        photos: rooms.reduce((n, r) => n + r.photoIds.length, 0),
        rooms: rooms.length,
        ref: inspection.ref || "",
        lastUpload: inspection.lastUpload || null,
        updatedAt: Date.now(),
      };
      const i = list.findIndex((x) => x.id === inspection.id);
      if (i === -1) list.push(summary); else list[i] = summary;
      await writeIndex(list);
    } catch (e) { writeFailed("Saving the inspection", e); }
  });
}

export function clearState(id) {
  return withIndex(async () => {
    try {
      await del(recordKey(id));
      await writeIndex((await loadIndex()).filter((x) => x.id !== id));
    } catch {}
  });
}

// Closing or discarding an inspection deletes its media one key at a time
// after the record is gone. If the tab is killed halfway, or a write failed
// months ago, the leftover blobs are unreachable and quietly eat the phone's
// storage. This removes any photo or voice note that no open inspection
// refers to. Only entries created before `olderThan` are touched, so a photo
// being saved right now (whose record may not have landed yet) is never
// mistaken for an orphan.
function uidTime(id) {
  const part = String(id).split("_")[1];
  const t = part ? parseInt(part, 36) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export async function sweepOrphans(olderThan) {
  try {
    const all = await keys();
    const media = all.filter((k) => typeof k === "string" && (k.startsWith("sitesnap:photo:") || k.startsWith("sitesnap:audio:")));
    if (!media.length) return 0;
    const index = await loadIndex();
    const live = new Set();
    for (const entry of index) {
      const rec = await loadInspection(entry.id);
      for (const r of (rec && rec.rooms) || []) {
        (r.photoIds || []).forEach((pid) => live.add(`sitesnap:photo:${pid}`));
        (r.memos || []).forEach((m) => live.add(`sitesnap:audio:${m.id}`));
      }
    }
    const stale = media.filter((k) => !live.has(k) && uidTime(k.split(":")[2]) < olderThan);
    if (stale.length) await delMany(stale);
    return stale.length;
  } catch (e) { console.error("orphan sweep failed", e); return 0; }
}

// A closed inspection leaves its photos behind (they live in the cloud now)
// but keeps a record, so "did Vernon Road actually go?" is answerable without
// opening OneDrive.
const ARCHIVE_KEY = "sitesnap:archive";

export async function loadArchive() {
  try { return (await get(ARCHIVE_KEY)) || []; } catch { return []; }
}

export async function archiveInspection(entry) {
  try {
    const list = await loadArchive();
    list.unshift(entry);
    await set(ARCHIVE_KEY, list.slice(0, 200));
  } catch (e) { writeFailed("Saving the completed record", e); }
}

export async function clearArchive() {
  try { await del(ARCHIVE_KEY); } catch {}
}

// One-time move of a pre-1.3 inspection into the multi-inspection store, so
// an upgrade mid-property doesn't lose the morning's work.
export async function migrateLegacy() {
  try {
    const old = await get(LEGACY_KEY);
    if (!old || !old.inspection || !old.rooms) return;
    await saveState(old.inspection, old.rooms);
    await del(LEGACY_KEY);
  } catch (e) { console.error("migrate failed", e); }
}

export async function loadPhoto(id) {
  try { return (await get(`sitesnap:photo:${id}`)) || null; } catch { return null; }
}
export async function savePhoto(photo) {
  try { await set(`sitesnap:photo:${photo.id}`, photo); } catch (e) { writeFailed("Saving a photo", e); throw e; }
}
// Patches fields on a stored photo without the caller having to hold the
// full-size image in memory (captions are edited from a lightweight copy).
export async function updatePhoto(id, patch) {
  try {
    const cur = await get(`sitesnap:photo:${id}`);
    if (!cur) return;
    await set(`sitesnap:photo:${id}`, { ...cur, ...patch });
  } catch (e) { writeFailed("Saving a photo", e); throw e; }
}
export async function removePhoto(id) {
  try { await del(`sitesnap:photo:${id}`); } catch {}
}

export async function loadWebhook() {
  try { return (await get(HOOK_KEY)) || ""; } catch { return ""; }
}
export async function saveWebhook(url) {
  try { await set(HOOK_KEY, url); } catch {}
}

export async function loadAudio(id) {
  try { return (await get(`sitesnap:audio:${id}`)) || null; } catch { return null; }
}
export async function saveAudio(id, blob) {
  try { await set(`sitesnap:audio:${id}`, blob); } catch (e) { writeFailed("Saving a voice note", e); throw e; }
}
export async function removeAudio(id) {
  try { await del(`sitesnap:audio:${id}`); } catch {}
}

export async function loadWebhookKey() {
  try { return (await get(KEY_KEY)) || ""; } catch { return ""; }
}
export async function saveWebhookKey(key) {
  try { await set(KEY_KEY, key); } catch {}
}

// Direct-to-cloud config: each provider's app (client) ID. Whoever runs the
// deployment can bake one in as a build-time env var (VITE_MS_CLIENT_ID /
// VITE_GOOGLE_CLIENT_ID — see docs/direct-cloud-link-setup.md) so every
// surveyor using that deployment just taps Connect; a per-device override
// entered in Settings always wins over the built-in one, for anyone running
// their own fork without the env var set. No token lives here — MSAL keeps
// its own cache, Google's token is in-memory only — this is just enough to
// reconnect without retyping the ID.
const MS_CLIENT_KEY = "sitesnap:msClientId";
const GOOGLE_CLIENT_KEY = "sitesnap:googleClientId";
const FIELD_MODE_KEY = "sitesnap:fieldMode";

const BUILT_IN_MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID || "";
const BUILT_IN_GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
export function hasBuiltInMsClientId() { return !!BUILT_IN_MS_CLIENT_ID; }
export function hasBuiltInGoogleClientId() { return !!BUILT_IN_GOOGLE_CLIENT_ID; }

export async function loadMsClientId() {
  try { return (await get(MS_CLIENT_KEY)) || BUILT_IN_MS_CLIENT_ID; } catch { return BUILT_IN_MS_CLIENT_ID; }
}
export async function saveMsClientId(id) {
  try { await set(MS_CLIENT_KEY, id); } catch {}
}
export async function loadGoogleClientId() {
  try { return (await get(GOOGLE_CLIENT_KEY)) || BUILT_IN_GOOGLE_CLIENT_ID; } catch { return BUILT_IN_GOOGLE_CLIENT_ID; }
}
export async function saveGoogleClientId(id) {
  try { await set(GOOGLE_CLIENT_KEY, id); } catch {}
}

export async function loadFieldMode() {
  try { return (await get(FIELD_MODE_KEY)) || false; } catch { return false; }
}
export async function saveFieldMode(on) {
  try { await set(FIELD_MODE_KEY, !!on); } catch {}
}

// Every case gets a real, permanent, sequential number — assigned once, at
// creation, never reused even if that case is later discarded. Queued the
// same way as the inspection index so two properties started back-to-back
// can't race each other onto the same number.
const CASE_NO_KEY = "sitesnap:nextCaseNo";
let caseNoQueue = Promise.resolve();

export function nextCaseNo() {
  const run = caseNoQueue.then(async () => {
    try {
      const n = (await get(CASE_NO_KEY)) || 1; // starts at 1 on a fresh device — purely a local counter, not tied to any external case log
      await set(CASE_NO_KEY, n + 1);
      return n;
    } catch (e) {
      writeFailed("Assigning a case number", e);
      return null;
    }
  });
  caseNoQueue = run.catch(() => {});
  return run;
}
