// Background filing: once a drive is linked, each photo goes up a few
// seconds after it's taken, in the same /Inspections/<address>/<folder>
// layout the Export tab uses — so by the time the surveyor reaches Export
// there's usually nothing left to send but the notes file.
//
// Never in the way: uploads run one at a time, wait for signal, retry a
// few times with backoff, and give up quietly on a photo so the manual
// upload can pick it up. The photo is on the phone regardless.
import { updatePhoto, loadMsClientId, loadGoogleClientId } from "./storage.js";
import { loadMsGraph, loadGoogleDrive } from "./cloud/lazy.js";
import { pad } from "./lib/util.js";

let provider = null; // "ms" | "google" | null
let getContext = () => null; // () => { inspection, rooms, photoCache, fileFor(room, id) }
let onFiled = () => {};

const queue = [];
const queued = new Set();
const attempts = new Map();
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
  queue.length = 0; queued.clear(); attempts.clear();
  state.filed = 0; state.failed = 0; state.lastError = null;
  emit();
}

function kick(delay = 0) { clearTimeout(timer); timer = setTimeout(work, delay); }
function drop(id) { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); queued.delete(id); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function work() {
  if (running || !provider || !queue.length) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return; // the online event re-kicks
  running = true; state.busy = true; emit();
  try {
    while (queue.length && provider) {
      const id = queue[0];
      const ctx = getContext();
      const room = ctx && ctx.inspection ? ctx.rooms.find((r) => r.photoIds.includes(id)) : null;
      const photo = ctx && ctx.photoCache[id];
      if (!room || !photo || (photo.filed && photo.filed.provider === provider)) { drop(id); emit(); continue; }
      try {
        const file = await ctx.fileFor(room, id);
        if (!file) { drop(id); emit(); continue; }
        const idx = ctx.rooms.indexOf(room);
        const segments = ["Inspections", ctx.inspection.address, `${pad(idx + 1)}. ${room.name}`];
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
        else { queue.push(queue.shift()); emit(); await sleep(4000 * n); if (navigator.onLine === false) break; }
      }
      emit();
    }
  } finally {
    running = false; state.busy = false; emit();
  }
}

if (typeof window !== "undefined") window.addEventListener("online", () => kick(800));
