// Keeps the firm's register (server/index.js, /api/cases) up to date with
// the case open on this phone. Pushes are debounced and coalesced — a burst
// of captions becomes one PUT — and thumbnails the server hasn't got yet
// follow in small batches. Nothing here blocks the surveyor: a failed or
// offline push is retried on the next change or when the phone comes back
// online, and the case lives on the phone regardless.
import { loadPhoto } from "./storage.js";

let enabled = false;
export function setSyncEnabled(on) { enabled = !!on; }

const state = { status: "idle", at: null, error: null, caseId: null }; // idle|syncing|synced|offline|error
const listeners = new Set();
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function syncState() { return { ...state }; }
function emit(patch) { Object.assign(state, patch); listeners.forEach((f) => f({ ...state })); }
export function resetSyncState(caseId) { emit({ status: "idle", at: null, error: null, caseId: caseId || null }); }

const pushedThumbs = new Set(); // photo ids the server has confirmed, this session
let timer = null;
let queued = null;
let inflight = null;
let inflightCaseId = null;
// set when a push fails (a thrown error, or the offline branch) and cleared
// on the next successful push — so the "back online" listener below has
// something to retry even though `queued` (which only tracks a pending
// *debounced* edit) is already null by the time a push fails
let lastFailedJob = null;

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export function queueCaseSync(inspection, rooms, photoCache, opts = {}) {
  if (!enabled || !inspection) return;
  queued = { inspection, rooms, photoCache, ...opts };
  clearTimeout(timer);
  timer = setTimeout(run, opts.now ? 0 : 2500);
}

// used when the answer matters right now (closing a case)
export function pushCaseNow(inspection, rooms, photoCache, opts = {}) {
  if (!enabled || !inspection) return Promise.resolve();
  queued = { inspection, rooms, photoCache, ...opts };
  clearTimeout(timer);
  return run();
}

async function run() {
  if (inflight) await inflight.catch(() => {});
  const job = queued;
  queued = null;
  if (!job) return;
  inflightCaseId = job.inspection.id;
  inflight = push(job).finally(() => { inflight = null; inflightCaseId = null; if (queued) run(); });
  return inflight;
}

function docFor(inspection, rooms) {
  const { activity, ...rest } = inspection;
  return {
    ...rest,
    activity: (activity || []).slice(-40),
    rooms: rooms.map((r) => ({
      id: r.id, name: r.name, condition: r.condition || null, note: r.note || "", noteSource: r.noteSource || null, aiNote: r.aiNote || null, hypothesis: r.hypothesis || "",
      modelVersion: r.modelVersion || 1, issues: r.issues || [], readings: r.readings || [], activeIssueId: r.activeIssueId || null,
      photoIds: r.photoIds, memos: (r.memos || []).map((m) => ({ id: m.id, secs: m.secs || null, at: m.at || null })),
    })),
  };
}

async function push({ inspection, rooms, photoCache, status, onCaseNo, keepalive }) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    emit({ status: "offline", caseId: inspection.id });
    lastFailedJob = { inspection, rooms, photoCache, status, onCaseNo };
    return;
  }
  emit({ status: "syncing", error: null, caseId: inspection.id });
  try {
    const photos = [];
    for (const r of rooms) {
      for (const pid of r.photoIds) {
        // photos not in memory (a case synced from its stored record) are
        // read for their number and caption only
        const p = photoCache[pid] || (keepalive ? null : await loadPhoto(pid)) || {};
        photos.push({ id: pid, roomId: r.id, no: p.no || null, caption: p.caption || "" });
      }
    }
    const r = await fetch(`/api/cases/${encodeURIComponent(inspection.id)}`, {
      ...json("PUT", {
        address: inspection.address, postcode: inspection.postcode || "", status: status || "open",
        startedAt: inspection.startedAt || null, closedAt: status === "closed" ? Date.now() : null,
        doc: docFor(inspection, rooms), photos,
      }),
      keepalive: !!keepalive,
    });
    if (r.status === 401) { window.dispatchEvent(new Event("ss:signed-out")); throw new Error("signed out"); }
    if (!r.ok) throw new Error(`the register answered ${r.status}`);
    const j = await r.json();
    if (j.case_no && onCaseNo) onCaseNo(j.case_no);

    // thumbnails don't fit a keepalive request; the next push sends them
    const missing = keepalive ? [] : (j.missingThumbs || []).filter((id) => !pushedThumbs.has(id));
    for (let i = 0; i < missing.length; i += 20) {
      const batch = [];
      for (const id of missing.slice(i, i + 20)) {
        const p = photoCache[id] || (await loadPhoto(id));
        const dataUrl = p && (p.thumb || p.dataUrl);
        // only a real thumbnail goes up — never a full-size photo
        if (dataUrl && dataUrl.length < 200000) batch.push({ id, dataUrl });
      }
      if (!batch.length) continue;
      const t = await fetch(`/api/cases/${encodeURIComponent(inspection.id)}/thumbs`, json("POST", { thumbs: batch }));
      if (t.ok) batch.forEach((b) => pushedThumbs.add(b.id));
    }
    emit({ status: "synced", at: Date.now(), error: null, caseId: inspection.id });
    lastFailedJob = null;
  } catch (e) {
    emit({ status: "error", error: e.message, caseId: inspection.id });
    lastFailedJob = { inspection, rooms, photoCache, status, onCaseNo };
  }
}

// The app can be swiped away inside the debounce. keepalive lets the PUT
// outlive the page; the record is small, so it fits the keepalive limit.
export function flushSync() {
  if (!queued) return;
  clearTimeout(timer);
  const job = queued;
  queued = null;
  push({ ...job, keepalive: true }).catch(() => {});
}

// Whenever the register is read, push any local case it doesn't have or
// that changed here since — covers a push that was lost to a swipe-away,
// a case created offline, or one edited on this phone after a reload.
export async function reconcile(localIndex, register, loadInspection) {
  if (!enabled) return 0;
  const remote = new Map((register || []).map((c) => [c.id, new Date(c.updated_at).getTime()]));
  let pushed = 0;
  for (const entry of localIndex || []) {
    // a push for this exact case is already queued or in flight via the
    // debounced path — pushing a second, independently-read copy here would
    // race it (whichever finishes last wins, and it might be reading a
    // staler snapshot); the debounced push will land on its own shortly
    if ((queued && queued.inspection.id === entry.id) || inflightCaseId === entry.id) continue;
    const at = remote.get(entry.id);
    if (at != null && at + 1500 >= (entry.updatedAt || 0)) continue;
    const data = await loadInspection(entry.id);
    if (!data || !data.inspection) continue;
    await push({ inspection: data.inspection, rooms: data.rooms || [], photoCache: {} });
    pushed += 1;
  }
  return pushed;
}

export async function deleteRemoteCase(id) {
  if (!enabled) return;
  try { await fetch(`/api/cases/${encodeURIComponent(id)}`, json("DELETE")); } catch { /* the next sync of nothing is fine */ }
}

export async function fetchRegister(status = "all") {
  const r = await fetch(`/api/cases?status=${status}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`register (${r.status})`);
  return (await r.json()).cases;
}

export async function fetchRemoteCase(id) {
  const r = await fetch(`/api/cases/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`case (${r.status})`);
  return (await r.json()).case;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (queued) { run(); return; }
    if (lastFailedJob) { queued = lastFailedJob; lastFailedJob = null; run(); }
  });
  window.addEventListener("pagehide", flushSync);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSync(); });
}
