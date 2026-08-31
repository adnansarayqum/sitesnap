// IndexedDB persistence via idb-keyval — survives closing the browser,
// holds far more than localStorage (photos are big).
import { get, set, del } from "idb-keyval";

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
  try { await set(INDEX_KEY, list); } catch (e) { console.error("index save failed", e); }
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
      updatedAt: Date.now(),
    };
    const i = list.findIndex((x) => x.id === inspection.id);
    if (i === -1) list.push(summary); else list[i] = summary;
    await writeIndex(list);
  } catch (e) { console.error("save failed", e); }
}

export async function clearState(id) {
  try {
    await del(recordKey(id));
    await writeIndex((await loadIndex()).filter((x) => x.id !== id));
  } catch {}
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
  try { await set(`sitesnap:photo:${photo.id}`, photo); } catch (e) { console.error("photo save failed", e); }
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
  try { await set(`sitesnap:audio:${id}`, blob); } catch (e) { console.error("audio save failed", e); }
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
