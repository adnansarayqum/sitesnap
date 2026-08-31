// IndexedDB persistence via idb-keyval — survives closing the browser,
// holds far more than localStorage (photos are big).
import { get, set, del } from "idb-keyval";

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

export async function loadInspection(id) {
  try { return (await get(recordKey(id))) || null; } catch { return null; }
}

export async function saveState(inspection, rooms) {
  if (!inspection) return;
  try {
    await set(recordKey(inspection.id), { inspection, rooms });
    const list = await loadIndex();
    const summary = {
      id: inspection.id,
      address: inspection.address,
      postcode: inspection.postcode || "",
      startedAt: inspection.startedAt,
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
}

export async function clearState(id) {
  try {
    await del(recordKey(id));
    await writeIndex((await loadIndex()).filter((x) => x.id !== id));
  } catch {}
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
