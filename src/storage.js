// IndexedDB persistence via idb-keyval — survives closing the browser,
// holds far more than localStorage (photos are big).
import { get, set, del } from "idb-keyval";

const INSP_KEY = "sitesnap:inspection";
const HOOK_KEY = "sitesnap:webhook";

export async function loadState() {
  try { return (await get(INSP_KEY)) || null; } catch { return null; }
}
export async function saveState(inspection, rooms) {
  try { await set(INSP_KEY, { inspection, rooms }); } catch (e) { console.error("save failed", e); }
}
export async function clearState() {
  try { await del(INSP_KEY); } catch {}
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
