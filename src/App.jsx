import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CloudUpload, Loader2, Undo2, X,
} from "lucide-react";
import {
  loadIndex, loadInspection, migrateLegacy, saveState, clearState, loadPhoto, savePhoto, updatePhoto, removePhoto, loadAudio, saveAudio, removeAudio, loadArchive, archiveInspection, sweepOrphans, setStorageErrorHandler, requestDurableStorage, storageEstimate, loadFieldMode, saveFieldMode, nextCaseNo, setStorageNamespace, loadWebhook,
} from "./storage.js";
import { THUMB_DIM, dataUrlToFile, drawScaled, loadImage, processCapture, shareFiles } from "./lib/image.js";
import { idPhotoName } from "./screens/Finish.jsx";
import { pad, safeFileName, uid } from "./lib/util.js";
import { CaseFileScreen } from "./screens/CaseFile.jsx";
import { CasesScreen, HomeScreen } from "./screens/Home.jsx";
import { RoomScreen } from "./screens/Room.jsx";
import { SettingsScreen } from "./screens/Settings.jsx";
import { SetupScreen } from "./screens/Setup.jsx";
import { WalkScreen } from "./screens/Walk.jsx";
import { StyleBlock } from "./styles.jsx";
import { beginLink, claimFromUrl, setAccountLinks } from "./cloud/service.js";
import { fetchMe, signOut as apiSignOut, captureInviteFromUrl, clearPendingInvite, inviteInfo, acceptInvite, cloudServiceConfig } from "./auth.js";
import { SignInScreen } from "./screens/SignIn.jsx";
import { OrgScreen } from "./screens/Org.jsx";
import { RemoteCaseScreen } from "./screens/RemoteCase.jsx";
import { setSyncEnabled, queueCaseSync, pushCaseNow, deleteRemoteCase, fetchRegister, reconcile, onSync, syncState, resetSyncState } from "./sync.js";
import { migrateRooms, migrateTranscripts, linkEvidence, unlinkEvidence, issueFor, typeNote, ROOM_MODEL_VERSION } from "./evidence.js";
import { migrateFindings } from "./findings.js";
import { configureTelemetry, track, flushTelemetry } from "./telemetry.js";
import { configureFiling, enqueueFiling, clearFilingQueue, onFiling, filingState } from "./filing.js";
import { linkedAccount } from "./cloud/service.js";

// Root: owns the open inspection, its rooms and the thumbnail cache, and
// routes between the top-level tabs and the screens inside a case file.
// Everything else lives in screens/, components/ and lib/.

// Every top-level screen swap goes through this — switching which `view ===`
// branch is true unmounts one screen and mounts another, so a fresh element
// with this class replays its entrance animation on every navigation, not
// just the very first paint. Cheap, but it's what makes switching screens
// read as movement instead of a hard cut.
// A synchronous write-ahead copy of what the debounced IndexedDB save is
// about to persist. An IndexedDB write started in pagehide can be dropped
// when the app is killed or reloaded straight after a keystroke; a
// localStorage write is synchronous, so the last edit survives and is
// replayed on the next open. Cleared as soon as the real save completes.
const WAL = {
  key: (id) => `sitesnap:wal:${id}`,
  capKey: (photoId) => `sitesnap:capwal:${photoId}`,
  write(id, inspection, rooms) { try { localStorage.setItem(WAL.key(id), JSON.stringify({ inspection, rooms })); } catch { /* full or blocked — the debounced save is still coming */ } },
  read(id) { try { const s = localStorage.getItem(WAL.key(id)); return s ? JSON.parse(s) : null; } catch { return null; } },
  clear(id) { try { localStorage.removeItem(WAL.key(id)); } catch { /* nothing to clear */ } },
  writeCaption(photoId, patch) { try { localStorage.setItem(WAL.capKey(photoId), JSON.stringify(patch)); } catch { /* as above */ } },
  readCaption(photoId) { try { const s = localStorage.getItem(WAL.capKey(photoId)); return s ? JSON.parse(s) : null; } catch { return null; } },
  clearCaption(photoId) { try { localStorage.removeItem(WAL.capKey(photoId)); } catch { /* nothing to clear */ } },
};

const SCREEN_STYLE = { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 };
const omit = (o, k) => { const { [k]: _x, ...rest } = o; return rest; };
function Screen({ children }) {
  return <div className="ss-screen-in" style={SCREEN_STYLE}>{children}</div>;
}

export default function SiteSnap() {
  // Three top-level tabs (home|cases|settings) carry the tab bar; opening a
  // case, starting a new one, or shooting is a full-screen flow on top of
  // them (setup|casefile|walk|evidence) with no tab bar of its own — it
  // returns to whichever tab it was opened from.
  const [screen, setScreen] = useState("loading");
  const [returnTab, setReturnTab] = useState("home");
  // accounts mode: who's signed in and which firm (null = server unreachable
  // or a deployment without a database, i.e. the single-user app)
  const [me, setMe] = useState(null);
  const [cfg, setCfg] = useState({ mode: "local", onedrive: false, google: false });
  const [invite, setInvite] = useState(null);
  const [inviteToken, setInviteToken] = useState(null);
  // the firm's case register (accounts mode) and this phone's sync status
  const [register, setRegister] = useState([]);
  const [sync, setSync] = useState(syncState());
  const [remoteCaseId, setRemoteCaseId] = useState(null);
  // background filing: which linked drive photos go to as they're taken,
  // and whether Home should still be asking where photos go
  const [filing, setFiling] = useState(filingState());
  const [needsCloud, setNeedsCloud] = useState(false);
  const [onedrivePrompt, setOnedrivePrompt] = useState(false);
  const [onedrivePromptBusy, setOnedrivePromptBusy] = useState(false);
  const filingCtx = useRef(null);
  const [caseTab, setCaseTab] = useState("overview"); // overview|rooms|findings|export, while screen === "casefile"
  const [inspection, setInspection] = useState(null);
  const [index, setIndex] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [photoCache, setPhotoCache] = useState({});
  const [walkIndex, setWalkIndex] = useState(0);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [undoItem, setUndoItem] = useState(null); // {photo, roomId}
  const [storageAlert, setStorageAlert] = useState(null);
  const [durable, setDurable] = useState(true);
  const [archive, setArchive] = useState([]);
  const [fieldMode, setFieldMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved"); // saving | saved — the quiet answer to "did that save?"
  const undoTimer = useRef(null);
  const originals = useRef({}); // id -> File/Blob (full quality, this session only)
  const audioCache = useRef({}); // memo id -> Blob
  const photoSeq = useRef({}); // roomId -> running exhibit number, reset per room

  // --- persistence -----------------------------------------------------
  // Whatever React has committed is what gets written, a beat later. Writing
  // from inside state updaters (the old approach) meant each write saw a
  // stale copy of the *other* half of the state — a note typed right after an
  // upload could save with the pre-upload inspection, or vice versa.
  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  const suppressSaveId = useRef(null); // set while an inspection is being deleted
  const photoTimers = useRef({});
  const pendingPhotos = useRef({});
  const saveNow = useRef(false); // a photo or voice note should not wait out the keystroke debounce

  function flushSave() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const p = pendingSave.current;
    pendingSave.current = null;
    return p ? saveState(p.inspection, p.rooms).then((r) => { WAL.clear(p.inspection.id); setSaveStatus("saved"); return r; }) : Promise.resolve();
  }
  function flushPhotoSaves() {
    Object.values(photoTimers.current).forEach(clearTimeout);
    photoTimers.current = {};
    const batch = Object.entries(pendingPhotos.current);
    pendingPhotos.current = {};
    return Promise.all(batch.map(([id, patch]) => updatePhoto(id, patch).then(() => WAL.clearCaption(id)).catch(() => {})));
  }

  // Only the thumbnail lives in memory; the stored copy is read back from
  // disk when something actually needs it (lightbox, export, upload, report).
  // Before this, opening a 150-photo job meant ~120 MB of base64 in the heap.
  async function fullPhoto(id) {
    const light = photoCache[id];
    if (light && light.dataUrl) return light;
    const rec = await loadPhoto(id);
    if (!rec) return light || null;
    return { ...rec, ...(light || {}), dataUrl: rec.dataUrl };
  }
  function lighten(photo) {
    return photo && photo.thumb ? { ...photo, dataUrl: null } : photo;
  }
  function flushAll() { return Promise.all([flushSave(), flushPhotoSaves()]); }

  useEffect(() => {
    if (!inspection || inspection.id === suppressSaveId.current) return;
    pendingSave.current = { inspection, rooms };
    setSaveStatus("saving");
    WAL.write(inspection.id, inspection, rooms);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, saveNow.current ? 0 : 250);
    saveNow.current = false;
  }, [inspection, rooms]);

  // accounts mode: the firm's register follows the phone (see sync.js).
  // The server hands out the case number on first sync; it lands on the
  // record here so every screen shows it.
  useEffect(() => {
    if (!inspection || inspection.id === suppressSaveId.current) return;
    const id = inspection.id;
    queueCaseSync(inspection, rooms, photoCache, {
      onCaseNo: (n) => setInspection((p) => (p && p.id === id && !p.caseNo ? { ...p, caseNo: n } : p)),
    });
  }, [inspection, rooms, photoCache]);

  useEffect(() => onSync(setSync), []);

  // The register is read when the Cases tab opens (and after sign-in), not
  // kept live; each read also pushes anything local the register is missing.
  async function syncRegister(m) {
    if (!(m && m.mode === "accounts" && m.user && m.org)) return;
    try {
      let rows = await fetchRegister("all");
      setRegister(rows);
      if (await reconcile(await loadIndex(), rows, loadInspection)) {
        rows = await fetchRegister("all");
        setRegister(rows);
      }
    } catch { /* offline, or signed out — the next read tries again */ }
  }
  useEffect(() => {
    if (screen === "cases") syncRegister(me);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  useEffect(() => {
    // The app can be swiped away mid-debounce. pagehide/visibilitychange are
    // the last chance, but a browser may abort a write started that late, so
    // leaving a text field also flushes — the moment the typing has stopped.
    function onHide() { if (document.visibilityState === "hidden") flushAll(); }
    function onFocusOut(e) {
      const t = e.target;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) flushAll();
    }
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onHide);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("focusout", onFocusOut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // moving between screens is a natural checkpoint
  useEffect(() => { flushAll(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [screen]);

  useEffect(() => {
    // A dropped write means photos that cannot be reshot, so it has to be
    // visible on screen rather than only in the console.
    setStorageErrorHandler(({ what, quota }) => {
      setStorageAlert(quota
        ? "This device is out of space. Free some up, then export or upload before shooting more — recent photos may not be saved."
        : `${what} failed. Export or upload this inspection now, before closing the app.`);
    });
    (async () => {
      await migrateLegacy();
      // back from a same-tab cloud sign-in (see cloud/service.js) — claimed
      // before /api/me so a sign-in pairing's cookie is already in place
      const claimed = await claimFromUrl();
      if (claimed && claimed.purpose === "link") setStorageAlert(`${claimed.label} connected${claimed.account ? " — " + claimed.account : ""}`);
      setCfg(await cloudServiceConfig());
      const token = captureInviteFromUrl();
      setInviteToken(token);
      if (token) inviteInfo(token).then(setInvite);
      const meAtBoot = await fetchMe();
      await applyMe(meAtBoot);
      // ask the browser not to evict an inspection under disk pressure;
      // browsers usually grant this only once the app is on the home screen
      requestDurableStorage().then((granted) => setDurable(granted));
      setIndex(await loadIndex());
      setArchive(await loadArchive());
      loadFieldMode().then(setFieldMode);
      setScreen("home");
      syncRegister(meAtBoot);
      // media left behind by an interrupted close/discard is unreachable
      // from any inspection and only wastes the phone's storage
      sweepOrphans(Date.now() - 60 * 1000).then((n) => { if (n) console.info(`removed ${n} orphaned media item(s)`); });
    })();
  }, []);

  async function refreshIndex() {
    setIndex(await loadIndex());
  }

  // accounts mode: apply what /api/me says — which person (so this phone's
  // lists are namespaced to them), their drive links, and their firm
  async function applyMe(m) {
    setMe(m);
    if (m && m.mode === "accounts") {
      setAccountLinks(m.user ? m.links : []);
      setStorageNamespace(m.user ? m.user.id : "");
    } else {
      setAccountLinks(null);
      setStorageNamespace("");
    }
    setSyncEnabled(!!(m && m.mode === "accounts" && m.user && m.org));
    configureTelemetry({ on: !!(m && m.mode === "accounts" && m.user && m.org) });
    setRegister([]);
  }

  async function reloadMe() {
    let m = await fetchMe();
    // an invitation carried in from a link is accepted once signed in
    if (inviteToken && m && m.user && !m.org) {
      try {
        await acceptInvite(inviteToken);
        clearPendingInvite(); setInviteToken(null); setInvite(null);
        m = await fetchMe();
      } catch { /* wrong email or expired — the firm screen explains */ }
    }
    await applyMe(m);
    await refreshIndex();
    setArchive(await loadArchive());
    syncRegister(m);
    maybePromptOneDrive(m);
  }

  // A one-time nudge right after a surveyor's first sign-in — Microsoft
  // sign-in already links OneDrive as part of that flow, so this only fires
  // for the email-code path. Flagged in localStorage so it shows once ever
  // per person; the slim status row on Home keeps reminding after that if
  // they skip it here.
  function maybePromptOneDrive(m) {
    if (!(m && m.mode === "accounts" && m.user && m.org && cfg.onedrive)) return;
    if ((m.links || []).some((l) => l.provider === "onedrive")) return;
    const key = `ss_od_prompt_${m.user.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch { return; }
    setOnedrivePrompt(true);
  }

  async function connectOneDriveFromPrompt() {
    setOnedrivePromptBusy(true);
    const win = window.open("about:blank", "_blank");
    try {
      const acct = await beginLink("onedrive", win);
      if (acct === null && !win) return; // this tab is navigating to the sign-in
      setOnedrivePrompt(false);
      setStorageAlert(`OneDrive connected${acct ? " — " + acct : ""}`);
      await reloadMe();
    } catch {
      try { win && win.close(); } catch { /* already gone */ }
      setOnedrivePrompt(false);
    } finally { setOnedrivePromptBusy(false); }
  }

  async function doSignOut() {
    await flushAll();
    try { await apiSignOut(); } catch { /* the session may already be gone */ }
    setInspection(null); setRooms([]); setPhotoCache({});
    setScreen("home");
    await reloadMe();
  }

  useEffect(() => {
    // any API call answered 401 — the session ended elsewhere
    const h = () => fetchMe().then(applyMe);
    window.addEventListener("ss:signed-out", h);
    return () => window.removeEventListener("ss:signed-out", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Photos and voice notes stay on disk until an inspection is closed, so
  // opening one only pulls that property's media into memory. `fromTab` is
  // remembered so the case file's back button returns to wherever it was
  // opened from (Home's active case, or the full Cases ledger).
  async function openInspection(id, fromTab = "home") {
    const data = await loadInspection(id);
    if (!data || !data.inspection) { await refreshIndex(); return; }
    // an edit whose IndexedDB save never completed (app killed mid-debounce)
    // is replayed from the write-ahead copy; the normal save then clears it
    const wal = WAL.read(id);
    if (wal && wal.inspection && wal.inspection.id === id) { data.inspection = wal.inspection; data.rooms = wal.rooms || data.rooms; }
    suppressSaveId.current = null;
    setReturnTab(fromTab);
    setCaseTab("overview");
    resetSyncState(id);
    // pre-2.0 cases open as they were: rooms gain an (empty) issue list and
    // honest provenance markers, transcripts become records, findings move
    // to the state machine — nothing is guessed about who wrote what
    const insp = { ...data.inspection, transcripts: migrateTranscripts(data.inspection.transcripts), findings: data.inspection.findings ? migrateFindings(data.inspection.findings) : data.inspection.findings };
    setInspection(insp);
    setRooms(migrateRooms(data.rooms || []));
    const ids = (data.rooms || []).flatMap((r) => r.photoIds);
    const entries = await Promise.all(ids.map(async (pid) => [pid, await loadPhoto(pid)]));
    const cache = {};
    for (const [pid, p] of entries) {
      if (!p) continue;
      if (!p.thumb && p.dataUrl) {
        // photo from before thumbnails existed — make one now so it too can
        // be held lightly, and keep it for next time
        try {
          const img = await loadImage(p.dataUrl);
          p.thumb = drawScaled(img, img.naturalWidth, img.naturalHeight, THUMB_DIM, 0.72);
          updatePhoto(pid, { thumb: p.thumb }).catch(() => {});
        } catch { /* keep the full copy in memory as before */ }
      }
      cache[pid] = lighten(p);
      const cap = WAL.readCaption(pid);
      if (cap) { cache[pid] = { ...cache[pid], ...cap }; updatePhoto(pid, cap).then(() => WAL.clearCaption(pid)).catch(() => {}); }
    }
    if (data.inspection.idPhotoId) {
      const p = await loadPhoto(data.inspection.idPhotoId);
      if (p) cache[p.id] = lighten(p);
    }
    setPhotoCache(cache);
    audioCache.current = {};
    const memoIds = (data.rooms || []).flatMap((r) => (r.memos || []).map((m) => m.id));
    await Promise.all(memoIds.map(async (mid) => {
      const b = await loadAudio(mid);
      if (b) audioCache.current[mid] = b;
    }));
    originals.current = {};
    photoSeq.current = {};
    for (const r of data.rooms || []) {
      photoSeq.current[r.id] = (r.photoIds || [])
        .reduce((m, pid) => Math.max(m, (cache[pid] && cache[pid].no) || 0), r.seq || 0);
    }
    setScreen("casefile");
    // anything shot offline, or before a drive was linked, files now
    const p = await refreshAutoFiling();
    clearFilingQueue();
    if (p) enqueueFiling(ids.filter((pid) => !(cache[pid] && cache[pid].filed && cache[pid].filed.provider === p)), 1500);
  }

  // Leaves the property loaded on disk — the surveyor is moving to the next
  // job, not finishing this one. Lands on whichever tab the case was opened
  // from by default, or `target` when a screen inside the case file (the
  // Export tab's cloud-settings link) sends the surveyor somewhere specific —
  // either way this is the ONLY path back to the top-level tabs, so it's the
  // one place `index` gets refreshed with what just changed.
  async function exitCase(target) {
    await flushAll();
    flushTelemetry();
    setInspection(null);
    setRooms([]);
    setPhotoCache({});
    originals.current = {};
    audioCache.current = {};
    photoSeq.current = {};
    await refreshIndex();
    setScreen(target || returnTab);
  }

  // A case's activity log is just another field on the inspection, so it
  // rides along on the same debounced save as everything else — no separate
  // store, no separate write path. Capped so a long job's log can't grow
  // without bound.
  function logActivity(text) {
    setInspection((prev) => {
      if (!prev) return prev;
      const entry = { ts: Date.now(), text };
      const activity = [...(prev.activity || []), entry].slice(-40);
      return { ...prev, activity };
    });
  }

  async function startInspection(address, postcode, roomList, caseDetails) {
    // in a firm the register numbers cases, on first sync; alone, this phone does
    const caseNo = me && me.mode === "accounts" && me.org ? null : await nextCaseNo();
    resetSyncState(null);
    const insp = {
      id: uid("insp"), address, postcode, startedAt: Date.now(), caseNo,
      activity: [{ ts: Date.now(), text: "Case opened" }],
      ...(caseDetails || {}),
    };
    const rms = roomList.map((r) => ({ id: r.id, name: r.name, photoIds: [], modelVersion: ROOM_MODEL_VERSION, issues: [], readings: [], activeIssueId: null }));
    track("case_created", { case: insp.id, rooms: rms.length });
    suppressSaveId.current = null;
    setReturnTab("home");
    setCaseTab("overview");
    setInspection(insp);
    setRooms(rms);
    setPhotoCache({});
    originals.current = {};
    photoSeq.current = {};
    clearFilingQueue();
    setScreen("casefile");
  }

  async function addPhoto(roomId, dataUrl, originalFile, thumb) {
    // a running number per room; a counter rather than a recount so a fast
    // burst of shots can't hand two photos the same number
    const room = rooms.find((r) => r.id === roomId);
    photoSeq.current[roomId] = Math.max(
      photoSeq.current[roomId] || 0,
      room ? room.photoIds.length : 0
    ) + 1;
    const no = photoSeq.current[roomId];
    const photo = { id: uid("ph"), roomId, no, caption: "", dataUrl, thumb: thumb || null, takenAt: Date.now() };
    if (originalFile) originals.current[photo.id] = originalFile;
    saveNow.current = true;
    setPhotoCache((c) => ({ ...c, [photo.id]: photo }));
    // `seq` rides along on the saved room so the counter survives a reload:
    // a number is never handed out twice for the life of the case, even
    // after the photo that had it is deleted — a reused "20 Kitchen.jpg"
    // would silently overwrite the one already filed in the drive
    // a photo taken while an issue is active belongs to that issue from the
    // moment it's shot — the association is recorded as made at capture
    setRooms((prev) => prev.map((r) => {
      if (r.id !== roomId) return r;
      const next = { ...r, photoIds: [...r.photoIds, photo.id], seq: no };
      const active = (next.issues || []).find((i) => i.id === next.activeIssueId && i.status !== "merged");
      return active ? linkEvidence(next, active.id, { id: photo.id, kind: "photo", source: "capture_session" }) : next;
    }));
    const roomName = (room || {}).name || "a room";
    const activeIssue = room && (room.issues || []).find((i) => i.id === room.activeIssueId);
    logActivity(`Photo added to ${roomName}${activeIssue ? ` · ${activeIssue.title}` : ""} — Exhibit ${no}`);
    if (totalPhotos === 0) track("inspection_started", { case: inspection.id, sinceStartMs: Date.now() - (inspection.startedAt || Date.now()) });
    track("photo_captured", { case: inspection.id, room: roomId, issue: activeIssue ? activeIssue.id : null });
    enqueueFiling([photo.id]);
    // if the write fails the full image stays in memory so it can still be
    // exported before the app closes; once written, only the thumbnail stays
    savePhoto(photo)
      .then(() => setPhotoCache((c) => (c[photo.id] ? { ...c, [photo.id]: lighten(c[photo.id]) } : c)))
      .catch(() => {});
    // low space long before it runs out, while there is still time to export
    storageEstimate().then((e) => {
      if (e && e.freeMB !== null && e.freeMB < 150) {
        setStorageAlert(`Only about ${e.freeMB} MB left on this device — upload or export soon.`);
      }
    });
  }

  // The stored copy is only removed once the undo window has lapsed, so undo
  // never has to write the image back (it may no longer be in memory).
  function finalizeDelete(photoId) {
    removePhoto(photoId);
    setPhotoCache((c) => { const { [photoId]: _gone, ...rest } = c; return rest; });
    delete originals.current[photoId];
  }

  function deletePhoto(roomId, photoId) {
    const photo = photoCache[photoId];
    const room = rooms.find((r) => r.id === roomId);
    const link = room ? issueFor(room, photoId) : null;
    const linkRec = link ? (link.evidence || []).find((e) => e.id === photoId) : null;
    setRooms((prev) => prev.map((r) =>
      r.id === roomId ? unlinkEvidence({ ...r, photoIds: r.photoIds.filter((id) => id !== photoId) }, photoId) : r
    ));
    delete pendingPhotos.current[photoId];
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (undoItem) finalizeDelete(undoItem.photo.id); // a second delete settles the first
    setUndoItem({ photo, roomId, issueId: link ? link.id : null, linkSource: linkRec ? linkRec.source : null });
    undoTimer.current = setTimeout(() => {
      setUndoItem(null);
      finalizeDelete(photoId);
    }, 5000);
  }

  function undoDelete() {
    if (!undoItem) return;
    const { photo, roomId, issueId, linkSource } = undoItem;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setRooms((prev) => prev.map((r) => {
      if (r.id !== roomId) return r;
      const next = { ...r, photoIds: [...r.photoIds, photo.id] };
      return issueId ? linkEvidence(next, issueId, { id: photo.id, kind: "photo", source: linkSource || "human_created" }) : next;
    }));
    setUndoItem(null);
  }

  function reorderRooms(next) {
    setRooms(next);
  }

  async function addMemo(roomId, blob, secs) {
    const id = uid("aud");
    try { await saveAudio(id, blob); } catch { return; } // the storage handler has already told the user
    audioCache.current[id] = blob;
    saveNow.current = true;
    setRooms((prev) => prev.map((r) => {
      if (r.id !== roomId) return r;
      const next = { ...r, memos: [...(r.memos || []), { id, secs, type: blob.type, at: Date.now() }] };
      const active = (next.issues || []).find((i) => i.id === next.activeIssueId && i.status !== "merged");
      return active ? linkEvidence(next, active.id, { id, kind: "memo", source: "capture_session" }) : next;
    }));
    const room = rooms.find((r) => r.id === roomId);
    const activeIssue = room && (room.issues || []).find((i) => i.id === room.activeIssueId);
    logActivity(`Voice note added to ${(room || {}).name || "a room"}${activeIssue ? ` · ${activeIssue.title}` : ""}`);
    track("memo_recorded", { case: inspection.id, room: roomId, issue: activeIssue ? activeIssue.id : null, durationMs: (secs || 0) * 1000 });
  }

  function deleteMemo(roomId, memoId) {
    setRooms((prev) => prev.map((r) =>
      r.id === roomId ? unlinkEvidence({ ...r, memos: (r.memos || []).filter((m) => m.id !== memoId) }, memoId) : r
    ));
    // the transcript record goes with it — a finding drafted from it will
    // read as stale on the next reconcile, which is the right outcome
    setInspection((prev) => {
      if (!prev || !prev.transcripts || !prev.transcripts[memoId]) return prev;
      const { [memoId]: _gone, ...rest } = prev.transcripts;
      return { ...prev, transcripts: rest };
    });
    removeAudio(memoId);
    delete audioCache.current[memoId];
  }

  function setInspectionMeta(patch) {
    setInspection((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // Issue, evidence-link, reading and AI-note changes all go through a
  // functional update on one room — the screens call evidence.js and hand
  // the result back, so every rule about provenance lives in one module.
  function updateRoom(roomId, fn) {
    setRooms((prev) => prev.map((r) => {
      if (r.id !== roomId) return r;
      const next = fn(r);
      // activation telemetry: a new issue or reading appeared
      const issuesBefore = (r.issues || []).length, issuesAfter = (next.issues || []).length;
      if (issuesAfter > issuesBefore) track("issue_created", { case: inspection && inspection.id, room: roomId, count: issuesAfter });
      if ((next.readings || []).length > (r.readings || []).length) track("reading_added", { case: inspection && inspection.id, room: roomId });
      if (next.aiNote && r.aiNote && next.aiNote.adopted && !r.aiNote.adopted) track("ai_note_used", { case: inspection && inspection.id, room: roomId });
      if (next.aiNote && r.aiNote && next.aiNote.dismissed && !r.aiNote.dismissed) track("ai_note_dismissed", { case: inspection && inspection.id, room: roomId });
      return next;
    }));
  }

  // the last room's "Finish inspection": the moment capture turns into
  // review. Recorded once; the case file opens on the summary.
  function finishInspection() {
    const already = inspection.completedAt;
    if (!already) {
      setInspectionMeta({ completedAt: Date.now() });
      const issues = rooms.reduce((n, r) => n + (r.issues || []).filter((i) => i.status !== "merged").length, 0);
      const memos = rooms.reduce((n, r) => n + (r.memos || []).length, 0);
      logActivity(`Inspection complete — ${rooms.filter((r) => r.photoIds.length).length} of ${rooms.length} rooms, ${issues} issue${issues === 1 ? "" : "s"}, ${totalPhotos} photo${totalPhotos === 1 ? "" : "s"}`);
      track("inspection_completed", { case: inspection.id, rooms: rooms.length, issues, photos: totalPhotos, memos, durationMs: Date.now() - (inspection.startedAt || Date.now()) });
    }
    setCaseTab("overview");
    setScreen("casefile");
  }
  function setTranscripts(fn) {
    setInspection((prev) => (prev ? { ...prev, transcripts: typeof fn === "function" ? fn(prev.transcripts || {}) : fn } : prev));
  }

  // The ID selfie is a photo of the case, not of a room: stored like any
  // other photo, referenced from the inspection, never in a room's list —
  // so it stays out of the numbered folders, the report and the AI step.
  async function addIdPhoto(file) {
    try {
      const { dataUrl, thumb } = await processCapture(file);
      const photo = { id: uid("ph"), roomId: null, no: null, caption: "ID photo", dataUrl, thumb, takenAt: Date.now() };
      saveNow.current = true;
      try { await savePhoto(photo); } catch { return; }
      const old = inspection && inspection.idPhotoId;
      if (old && old !== photo.id) removePhoto(old);
      setPhotoCache((c) => ({ ...c, [photo.id]: lighten(photo) }));
      setInspectionMeta({ idPhotoId: photo.id });
      logActivity("ID photo taken");
    } catch (e) { console.error(e); }
  }
  function removeIdPhoto() {
    const id = inspection && inspection.idPhotoId;
    if (!id) return;
    removePhoto(id);
    setPhotoCache((c) => { const n = { ...c }; delete n[id]; return n; });
    setInspectionMeta({ idPhotoId: null });
  }
  async function shareIdPhoto() {
    const id = inspection && inspection.idPhotoId;
    if (!id) return;
    const p = await fullPhoto(id);
    if (!p || !p.dataUrl) return;
    await shareFiles([dataUrlToFile(p.dataUrl, idPhotoName(inspection))], "ID photo");
  }

  // A caption is typed one character at a time, and each photo record carries
  // its full-size image — so the write is debounced per photo rather than
  // rewriting a megabyte on every keystroke.
  // `aiGenerated` marks a caption the AI wrote and the surveyor hasn't
  // touched yet (shown with a small badge) — any manual edit calls this
  // without it, which is what clears the badge.
  function setPhotoCaption(photoId, caption, aiGenerated = false) {
    if (!aiGenerated && photoCache[photoId] && photoCache[photoId].captionAi) track("caption_edited", { case: inspection && inspection.id });
    WAL.writeCaption(photoId, { caption, captionAi: !!aiGenerated });
    setPhotoCache((c) => {
      const p = c[photoId];
      if (!p) return c;
      pendingPhotos.current[photoId] = { caption, captionAi: !!aiGenerated };
      return { ...c, [photoId]: { ...p, caption, captionAi: !!aiGenerated } };
    });
    if (photoTimers.current[photoId]) clearTimeout(photoTimers.current[photoId]);
    photoTimers.current[photoId] = setTimeout(() => {
      delete photoTimers.current[photoId];
      if (photoId in pendingPhotos.current) {
        const patch = pendingPhotos.current[photoId];
        delete pendingPhotos.current[photoId];
        updatePhoto(photoId, patch).then(() => WAL.clearCaption(photoId)).catch(() => {});
      }
    }, 250);
  }

  function setRoomMeta(roomId, patch) {
    // a note typed by a person is recorded as such; any other field is a plain patch
    setRooms((prev) => prev.map((r) => (r.id === roomId ? ("note" in patch ? { ...typeNote(r, patch.note), ...omit(patch, "note") } : { ...r, ...patch }) : r)));
    // only condition changes are worth a log line — logging every keystroke
    // of a note would flood it
    if ("condition" in patch) {
      const roomName = (rooms.find((r) => r.id === roomId) || {}).name || "a room";
      logActivity(patch.condition ? `${roomName} rated ${patch.condition}` : `${roomName} rating cleared`);
    }
  }

  function addRoom(name) {
    setRooms((prev) => [...prev, { id: uid("room"), name, photoIds: [], modelVersion: ROOM_MODEL_VERSION, issues: [], readings: [], activeIssueId: null }]);
  }

  async function finishAndReset() {
    // nothing pending may be written back after the record is deleted, or the
    // inspection would reappear on the home screen as a zombie
    suppressSaveId.current = inspection.id;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    pendingSave.current = null;
    WAL.clear(inspection.id);
    Object.values(photoTimers.current).forEach(clearTimeout);
    photoTimers.current = {};
    pendingPhotos.current = {};
    const ids = rooms.flatMap((r) => r.photoIds);
    ids.forEach((id) => WAL.clearCaption(id));
    const memoIds = rooms.flatMap((r) => (r.memos || []).map((m) => m.id));
    // the register keeps the closed case (with its thumbnails) after the
    // phone lets the photos go
    await pushCaseNow(inspection, rooms, photoCache, { status: "closed" }).catch(() => {});
    await archiveInspection({
      id: inspection.id,
      address: inspection.address,
      postcode: inspection.postcode || "",
      ref: inspection.ref || "",
      caseNo: inspection.caseNo || null,
      startedAt: inspection.startedAt,
      closedAt: Date.now(),
      photos: ids.length,
      rooms: rooms.length,
      lastUpload: inspection.lastUpload || null,
      lastExport: inspection.lastExport || null,
    });
    setArchive(await loadArchive());
    await clearState(inspection.id);
    ids.forEach((id) => removePhoto(id));
    if (inspection.idPhotoId) removePhoto(inspection.idPhotoId);
    memoIds.forEach((id) => removeAudio(id));
    await exitCase();
  }

  // Discards a whole property from the list without opening it.
  async function discardInspection(id) {
    const data = await loadInspection(id);
    WAL.clear(id);
    if (data && data.rooms) {
      data.rooms.flatMap((r) => r.photoIds).forEach((pid) => { removePhoto(pid); WAL.clearCaption(pid); });
      data.rooms.flatMap((r) => (r.memos || []).map((m) => m.id)).forEach((mid) => removeAudio(mid));
    }
    if (data && data.inspection && data.inspection.idPhotoId) removePhoto(data.inspection.idPhotoId);
    await clearState(id);
    await refreshIndex();
    deleteRemoteCase(id);
  }

  // Filenames read like the report: "03 Kitchen - damp and mould to ceiling.jpg",
  // so a spreadsheet can pick up the defect without anyone renaming anything.
  function photoFilename(photo, room, i, ext) {
    const n = photo && photo.no ? pad(photo.no) : pad(i + 1);
    const caption = (photo && photo.caption ? photo.caption : "").trim();
    const base = caption ? `${n} ${room.name} - ${caption}` : `${n} ${room.name}`;
    return `${safeFileName(base)}.${ext}`;
  }

  // compressedOnly: webhook/Graph uploads have 4-5MB request limits, so the
  // cloud path always sends the compressed copy; exports keep full quality.
  async function filesFor(room, compressedOnly = false) {
    const out = [];
    for (let i = 0; i < room.photoIds.length; i++) {
      const id = room.photoIds[i];
      const light = photoCache[id];
      const orig = compressedOnly ? null : originals.current[id];
      if (orig) {
        const ext = ((orig.type && orig.type.split("/")[1]) || "jpg").replace(/^jpeg$/, "jpg");
        out.push(new File([orig], photoFilename(light, room, i, ext), { type: orig.type || "image/jpeg" }));
        continue;
      }
      const p = await fullPhoto(id);
      if (p && p.dataUrl) out.push(dataUrlToFile(p.dataUrl, photoFilename(p, room, i, "jpg")));
    }
    return out;
  }
  async function filesForAll(compressedOnly = false) {
    const lists = [];
    for (const r of rooms) lists.push(await filesFor(r, compressedOnly));
    return lists.flat();
  }

  const totalPhotos = rooms.reduce((s, r) => s + r.photoIds.length, 0);
  const doneRooms = rooms.filter((r) => r.photoIds.length > 0).length;

  // the compressed copy, named like the report — what the Export tab sends
  async function fileForPhoto(room, id) {
    const p = await fullPhoto(id);
    if (!p || !p.dataUrl) return null;
    return dataUrlToFile(p.dataUrl, photoFilename(p, room, room.photoIds.indexOf(id), "jpg"));
  }
  filingCtx.current = { inspection, rooms, photoCache, fileFor: fileForPhoto };

  function markFiled(id, filed) {
    setPhotoCache((c) => (c[id] ? { ...c, [id]: { ...c[id], filed } } : c));
  }

  // which drive (if any) is linked through the service decides whether
  // photos file themselves; re-read whenever that could have changed
  async function refreshAutoFiling() {
    const p = (await linkedAccount("onedrive")) ? "ms" : (await linkedAccount("google")) ? "google" : null;
    configureFiling({ provider: p, context: () => filingCtx.current, filed: markFiled });
    setNeedsCloud(!p && !(await loadWebhook()));
    return p;
  }
  useEffect(() => onFiling(setFiling), []);
  useEffect(() => {
    if (screen === "home" || screen === "casefile") refreshAutoFiling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  function toggleFieldMode() {
    setFieldMode((prev) => { const next = !prev; saveFieldMode(next); return next; });
  }

  // On-photo annotation flattens the marked-up copy straight onto the stored
  // photo — the annotated version becomes the evidence that gets exported,
  // same as marking up a print with a pen.
  async function annotatePhoto(photoId, dataUrl, thumb) {
    setPhotoCache((c) => (c[photoId] ? { ...c, [photoId]: { ...c[photoId], dataUrl, thumb } } : c));
    await updatePhoto(photoId, { dataUrl, thumb }).catch(() => {});
  }

  const accounts = !!(me && me.mode === "accounts");
  const gate = screen !== "loading" && accounts && !me.user
    ? <SignInScreen config={cfg} invite={invite} inviteToken={inviteToken} onSignedIn={reloadMe} />
    : screen !== "loading" && accounts && !me.org
      ? <OrgScreen me={me} invite={invite} inviteToken={inviteToken} onDone={reloadMe} onSignOut={doSignOut} />
      : null;
  const view = gate ? "gate" : screen;

  return (
    <div className={`ss-root${fieldMode ? " ss-field" : ""}`}>
      <StyleBlock />
      <div className="ss-frame">
        {gate}
        {view === "loading" && (
          <div className="ss-center"><Loader2 className="ss-spin" size={26} /></div>
        )}

        {view === "home" && (
          <Screen><HomeScreen
            index={index}
            orgName={accounts && me.org ? me.org.name : null}
            needsCloud={needsCloud}
            onNew={() => { setReturnTab("home"); setScreen("setup"); }}
            onOpen={(id) => openInspection(id, "home")}
            onTab={setScreen}
          /></Screen>
        )}

        {view === "cases" && (
          <Screen><CasesScreen
            index={index}
            archive={archive}
            durable={durable}
            onNew={() => { setReturnTab("cases"); setScreen("setup"); }}
            onOpen={(id) => openInspection(id, "cases")}
            onDiscard={discardInspection}
            onTab={setScreen}
            register={register}
            onOpenRemote={(id) => { setRemoteCaseId(id); setScreen("remotecase"); }}
          /></Screen>
        )}

        {view === "settings" && (
          <Screen><SettingsScreen
            fieldMode={fieldMode}
            onToggleFieldMode={toggleFieldMode}
            onTab={setScreen}
            me={me}
            onSignOut={doSignOut}
            onMeChanged={reloadMe}
          /></Screen>
        )}

        {view === "remotecase" && remoteCaseId && (
          <Screen><RemoteCaseScreen id={remoteCaseId} onBack={() => setScreen("cases")} /></Screen>
        )}

        {view === "setup" && (
          <Screen><SetupScreen onBack={() => setScreen(returnTab)} onStart={startInspection} /></Screen>
        )}

        {view === "casefile" && inspection && (
          <Screen><CaseFileScreen
            inspection={inspection}
            sync={accounts && me.org ? sync : null}
            rooms={rooms}
            photoCache={photoCache}
            totalPhotos={totalPhotos}
            doneRooms={doneRooms}
            caseTab={caseTab}
            onCaseTab={setCaseTab}
            onExit={exitCase}
            onReorder={reorderRooms}
            onAddRoom={addRoom}
            onRename={(patch) => setInspectionMeta(patch)}
            onOpenRoom={(id) => { setActiveRoomId(id); setScreen("evidence"); }}
            onWalk={(startIdx) => { setWalkIndex(startIdx); setScreen("walk"); }}
            filesForRoom={(room) => filesFor(room)}
            filesForUpload={(room) => filesFor(room, true)}
            fullPhoto={fullPhoto}
            audioCache={audioCache}
            onUploadResult={(r) => { setInspectionMeta({ lastUpload: r }); logActivity(r.ok ? (r.confirmed ? "Filed in the cloud" : "Sent to the cloud") : "Upload didn't finish"); if (r.ok) track("export_cloud", { case: inspection.id, count: r.total }); }}
            onExportResult={(r) => { setInspectionMeta({ lastExport: r, ...(r.kind === "report" ? { lastReport: r } : {}) }); track(r.kind === "report" ? "report_generated" : "export_zip", { case: inspection.id, sinceStartMs: Date.now() - (inspection.startedAt || Date.now()) }); }}
            onFindings={(f) => setInspectionMeta({ findings: f })}
            onTranscripts={setTranscripts}
            onRoom={updateRoom}
            onTrack={track}
            me={me}
            syncNow={accounts && me.org ? () => pushCaseNow(inspection, rooms, photoCache) : null}
            onActivity={logActivity}
            idPhoto={inspection.idPhotoId ? photoCache[inspection.idPhotoId] || null : null}
            onIdPhoto={addIdPhoto}
            onRemoveIdPhoto={removeIdPhoto}
            onShareIdPhoto={shareIdPhoto}
            filing={filing}
            onFiled={(ids, provider) => ids.forEach((id) => markFiled(id, { provider, at: Date.now() }))}
            onSaveAll={async () => shareFiles(await filesForAll(), "Inspection photos")}
            onDone={finishAndReset}
          /></Screen>
        )}

        {view === "walk" && inspection && rooms[walkIndex] && (
          <Screen><WalkScreen
            inspection={inspection}
            rooms={rooms}
            index={walkIndex}
            photoCache={photoCache}
            sync={accounts && me.org ? sync : null}
            saveStatus={saveStatus}
            onOpenRoom={(id) => { setActiveRoomId(id); setScreen("evidence"); }}
            onFinish={finishInspection}
            onIndex={setWalkIndex}
            onCapture={(dataUrl, file, thumb) => addPhoto(rooms[walkIndex].id, dataUrl, file, thumb)}
            onError={setStorageAlert}
            onDeleteLast={() => {
              const r = rooms[walkIndex];
              const last = r.photoIds[r.photoIds.length - 1];
              if (last) deletePhoto(r.id, last);
            }}
            onMeta={(patch) => setRoomMeta(rooms[walkIndex].id, patch)}
            onRoom={(fn) => updateRoom(rooms[walkIndex].id, fn)}
            onAddMemo={(blob, secs) => addMemo(rooms[walkIndex].id, blob, secs)}
            onDeleteMemo={(mid) => deleteMemo(rooms[walkIndex].id, mid)}
            onActivity={logActivity}
            onExit={() => setScreen("casefile")}
            filing={filing}
            fieldMode={fieldMode}
            onToggleFieldMode={toggleFieldMode}
          /></Screen>
        )}

        {view === "evidence" && (() => {
          const room = rooms.find((r) => r.id === activeRoomId);
          if (!room) { setScreen("casefile"); return null; }
          return (
            <Screen><RoomScreen
              room={room}
              caseId={inspection.id}
              photos={room.photoIds.map((id) => photoCache[id]).filter(Boolean)}
              onBack={() => setScreen("casefile")}
              onCapture={(dataUrl, file, thumb) => addPhoto(room.id, dataUrl, file, thumb)}
              onError={setStorageAlert}
              onDelete={(pid) => deletePhoto(room.id, pid)}
              onMeta={(patch) => setRoomMeta(room.id, patch)}
              onRoom={(fn) => updateRoom(room.id, fn)}
              transcripts={inspection.transcripts || {}}
              onTranscripts={setTranscripts}
              audioCache={audioCache}
              me={me}
              onActivity={logActivity}
              onTrack={track}
              onCaption={setPhotoCaption}
              onFull={fullPhoto}
              onAnnotate={annotatePhoto}
              onAddMemo={(blob, secs) => addMemo(room.id, blob, secs)}
              onDeleteMemo={(mid) => deleteMemo(room.id, mid)}
              onSaveToPhotos={async () => shareFiles(await filesFor(room), `${room.name} photos`)}
            /></Screen>
          );
        })()}

        {storageAlert && (
          <div className="ss-alert">
            <AlertTriangle size={16} />
            <span>{storageAlert}</span>
            <button onClick={() => setStorageAlert(null)} aria-label="Dismiss"><X size={15} /></button>
          </div>
        )}

        {undoItem && (
          <div className="ss-toast">
            <span>Photo deleted</span>
            <button onClick={undoDelete}><Undo2 size={15} /> Undo</button>
          </div>
        )}

        {onedrivePrompt && view !== "gate" && (
          <div className="ss-modal-back" onClick={() => (onedrivePromptBusy ? null : setOnedrivePrompt(false))}>
            <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ss-modal-icon"><CloudUpload size={22} /></div>
              <div className="ss-modal-title">Connect OneDrive?</div>
              <p>Photos file themselves into OneDrive as you shoot — one sign-in now saves you finding somewhere to send them at the end of every job.</p>
              <button className="ss-btn ss-btn-primary ss-btn-big" disabled={onedrivePromptBusy} onClick={connectOneDriveFromPrompt}>
                {onedrivePromptBusy ? <Loader2 size={18} className="ss-spin" /> : <CloudUpload size={18} />} Connect OneDrive
              </button>
              <button className="ss-link" style={{ marginTop: 10 }} disabled={onedrivePromptBusy} onClick={() => setOnedrivePrompt(false)}>Skip for now</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
