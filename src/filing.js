// Background filing: once a drive is linked, each photo goes up a few
// seconds after it's taken, in the same /Inspections/<address>/Site photos/<room>
// layout the Export tab uses (src/lib/layout.js) — so by the time the surveyor reaches Export
// there's usually nothing left to send but the notes file.
//
// Never in the way: uploads run one at a time, wait for signal, retry a
// few times with backoff, and give up quietly on a photo so the manual
// upload can pick it up. The photo is on the phone regardless.
import { updatePhoto, loadMsClientId, loadGoogleClientId } from "./storage.js";
import { loadMsGraph, loadGoogleDrive } from "./cloud/lazy.js";
import { photoSegments } from "./lib/layout.js";

let provider = null; // "ms" | "google" | null
let getContext = () => null; // () => { inspection, rooms, photoCache, fileFor(room, id) }
let onFiled = () => {};

const queue = [];
const queued = new Set();
const attempts = new Map();
const nextAttemptAt = new Map(); // id -> a failed upload's own backoff, not the whole queue's
let running = false;
let timer = null;

const state = { provider: null, pending: 0, filed: 0, failed: 0, busy: false, lastError: null };
const listeners = new Set();
export function onFiling(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function filingState() { return { ...state }; }
function emit() { state.pending = queue.length; state.provider = provider; listeners.forEach((f) => f({ ...state })); }

export function configureFiling({ provider: p, context, filed }) {
  provider = p || null;
  if (context) getContext = context;
  if (filed) onFiled = filed;
  emit();
  if (provider && queue.length) kick(500);
}

export function enqueueFiling(photoIds, delay = 3000) {
  if (!provider) return;
  for (const id of photoIds) if (!queued.has(id)) { queue.push(id); queued.add(id); }
  emit();
  kick(delay);
}

export function clearFilingQueue() {
  queue.length = 0; queued.clear(); attempts.clear(); nextAttemptAt.clear();
  state.filed = 0; state.failed = 0; state.lastError = null;
  emit();
}

function kick(delay = 0) { clearTimeout(timer); timer = setTimeout(work, delay); }
function drop(id) { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); queued.delete(id); nextAttemptAt.delete(id); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function work() {
  if (running || !provider || !queue.length) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return; // the online event re-kicks
  running = true; state.busy = true; emit();
  try {
    while (queue.length && provider) {
      // a photo mid-backoff after a failed attempt shouldn't hold up every
      // *other* photo behind it in the queue — find the first one actually
      // due, and only wait (for the soonest one) when every photo is still
      // in backoff and there's truly nothing else to try right now
      const now = Date.now();
      const readyIdx = queue.findIndex((qid) => (nextAttemptAt.get(qid) || 0) <= now);
      if (readyIdx === -1) {
        const soonest = Math.min(...queue.map((qid) => nextAttemptAt.get(qid) || 0));
        await sleep(Math.max(200, soonest - now));
        if (navigator.onLine === false) break;
        continue;
      }
      const id = queue[readyIdx];
      const ctx = getContext();
      const room = ctx && ctx.inspection ? ctx.rooms.find((r) => r.photoIds.includes(id)) : null;
      const photo = ctx && ctx.photoCache[id];
      if (!room || !photo || (photo.filed && photo.filed.provider === provider)) { drop(id); emit(); continue; }
      try {
        const file = await ctx.fileFor(room, id);
        if (!file) { drop(id); emit(); continue; }
        const idx = ctx.rooms.indexOf(room);
        const segments = photoSegments(ctx.inspection.address, idx, room.name);
        if (provider === "ms") {
          const { uploadToOneDrive } = await loadMsGraph();
          await uploadToOneDrive(await loadMsClientId(), [...segments, file.name], file);
        } else {
          const { uploadToGoogleDrive } = await loadGoogleDrive();
          await uploadToGoogleDrive(await loadGoogleClientId(), segments, file.name, file);
        }
        const filed = { provider, at: Date.now() };
        await updatePhoto(id, { filed }).catch(() => {});
        onFiled(id, filed);
        state.filed += 1;
        drop(id);
      } catch (e) {
        const n = (attempts.get(id) || 0) + 1;
        attempts.set(id, n);
        state.lastError = (e && e.message) || "upload failed";
        if (n >= 3) { state.failed += 1; drop(id); }
        else nextAttemptAt.set(id, Date.now() + 4000 * n);
      }
      emit();
    }
  } finally {
    running = false; state.busy = false; emit();
  }
}

if (typeof window !== "undefined") window.addEventListener("online", () => kick(800));
