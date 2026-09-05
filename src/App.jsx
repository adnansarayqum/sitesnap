import React, { useState, useEffect, useRef } from "react";
import {
  Camera, Trash2, GripVertical, ChevronLeft, Plus, Minus, MapPin,
  CloudUpload, Check, X, Loader2, ImagePlus, ArrowRight, ArrowLeft,
  Undo2, FolderTree, CircleCheck, Image as ImageIcon, Download, Link2,
  StickyNote, FileText, Printer, AlertTriangle, Mic, MicOff, KeyRound, Briefcase, Smartphone, Pencil,
  RefreshCw, Aperture, Settings as SettingsIcon, Search, SlidersHorizontal, Sun, Moon,
  Circle, MoveUpRight, ShieldCheck, Clock, HardDrive, ChevronRight, Tag,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  SiteSnap — room-by-room property inspection photos                 */
/*  Mockup v2: walkthrough capture, one-screen setup, ledger overview  */
/* ------------------------------------------------------------------ */

// The surveyor's own SOURCE list from his report workbook — folder names must
// match these exactly or his macro can't line the photos up with the findings.
// Numbered variants (Bedroom 1-4, Bathroom 1-3) come from the +/- stepper, so
// they aren't listed separately.
const PRESET_GROUPS = [
  {
    group: "Rooms",
    items: [
      { base: "Kitchen" }, { base: "Living Room" }, { base: "Dining Room" },
      { base: "Bedroom", steppable: true }, { base: "Bedrooms" },
      { base: "Bathroom", steppable: true }, { base: "Bathroom (Upstairs)" },
      { base: "Upstairs Bathroom" }, { base: "Downstairs Bathroom" },
      { base: "Wet Room" }, { base: "Toilet" }, { base: "Downstairs Toilet" },
      { base: "Separate WC" }, { base: "WC" }, { base: "Utility Room" },
      { base: "Hallway" }, { base: "Upstairs Hallway" }, { base: "Hallway and Landing" },
      { base: "Landing" }, { base: "Landing/Stairs" },
      { base: "Attic" }, { base: "Balcony" },
    ],
  },
  {
    group: "Services",
    items: [
      { base: "Boiler" }, { base: "Boiler/Heating" }, { base: "Heating" },
      { base: "Electrics" }, { base: "Windows" },
      { base: "Doors & Windows (Throughout)" },
      { base: "Front Door" }, { base: "Back Door" },
    ],
  },
  {
    group: "Outside",
    items: [
      { base: "External" }, { base: "Exterior" }, { base: "External Areas" },
      { base: "External Walls & Drains" }, { base: "Garden" },
      { base: "Other (Exterior)" },
    ],
  },
  {
    group: "Whole property & other",
    items: [
      { base: "Property" }, { base: "Whole Property" }, { base: "Throughout Property" },
      { base: "Infestation" }, { base: "Additional Claim Item", steppable: true },
      { base: "Other" },
    ],
  },
];

const PRESETS = PRESET_GROUPS.flatMap((g) => g.items);

const CONDITIONS = ["Good", "Fair", "Poor"];

function uid(p) {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}

// Windows, OneDrive and Excel all choke on different characters; strip the
// union of them so a caption can be typed naturally on site.
function safeFileName(s) {
  return String(s)
    .replace(/[\\/:*?"<>|#%{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/* ---------- image helpers ---------- */

const PHOTO_DIM = 2200;   // stored copy: fine for a printed report, under Graph's 4 MB upload cap
const THUMB_DIM = 480;    // grid/list copy: a 2200px JPEG decodes to ~19 MB of bitmap per cell

function fitWithin(width, height, maxDim) {
  if (width <= maxDim && height <= maxDim) return [width, height];
  return width > height
    ? [maxDim, Math.round((height * maxDim) / width)]
    : [Math.round((width * maxDim) / height), maxDim];
}

// `source` is anything drawImage accepts (an <img>, a <video>, a canvas).
function drawScaled(source, srcW, srcH, maxDim, quality) {
  const [w, h] = fitWithin(srcW, srcH, maxDim);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(source, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image couldn't be decoded"));
    img.src = src;
  });
}

// Decodes the picked/shot file once and produces both the stored copy and a
// small thumbnail for lists. Decoding via an object URL avoids first turning
// a 10 MB original into a 13 MB base64 string just to read it back.
async function processCapture(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    return {
      dataUrl: drawScaled(img, w, h, PHOTO_DIM, 0.87),
      thumb: drawScaled(img, w, h, THUMB_DIM, 0.72),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlToFile(dataUrl, name) {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

function canShareFiles() {
  return typeof navigator !== "undefined" && !!navigator.canShare && !!navigator.share;
}

async function shareFiles(files, title) {
  if (!files.length) return { ok: false, reason: "empty" };
  if (!canShareFiles()) return { ok: false, reason: "unsupported" };
  try {
    if (navigator.canShare({ files })) {
      await navigator.share({ files, title });
      return { ok: true };
    }
    return { ok: false, reason: "unsupported" };
  } catch (err) {
    if (err && err.name === "AbortError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "error" };
  }
}

/* ---------- storage (IndexedDB — see src/storage.js) ---------- */

import JSZip from "jszip";
import {
  loadIndex, loadInspection, migrateLegacy, saveState, clearState,
  loadPhoto, savePhoto, updatePhoto, removePhoto,
  loadAudio, saveAudio, removeAudio,
  loadWebhook, saveWebhook,
  loadWebhookKey, saveWebhookKey,
  loadArchive, archiveInspection, sweepOrphans,
  setStorageErrorHandler, requestDurableStorage, storageEstimate,
  loadMsClientId, saveMsClientId, loadGoogleClientId, saveGoogleClientId,
  hasBuiltInMsClientId, hasBuiltInGoogleClientId,
  loadFieldMode, saveFieldMode,
} from "./storage.js";
// Loaded on demand, not at startup: MSAL and Google's SDK are only weight
// worth paying for a surveyor who actually connects a direct cloud link —
// everyone else is here to shoot photos, and that path stays light.
const loadMsGraph = () => import("./cloud/msGraph.js");
const loadGoogleDrive = () => import("./cloud/googleDrive.js");

/* ---------- voice memos ---------- */

function canRecord() {
  return typeof navigator !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    && typeof MediaRecorder !== "undefined";
}

function pickAudioType() {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
}

function extFor(mime) {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function mmss(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Records on the device and keeps the blob locally — works with no signal,
// which browser speech-to-text does not. Transcription happens in the cloud
// workflow after upload.
function VoiceMemo({ memos, onAdd, onDelete, dark }) {
  const [state, setState] = useState("idle"); // idle|recording|denied|unsupported
  const [secs, setSecs] = useState(0);
  const rec = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const secsRef = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (rec.current && rec.current.state === "recording") rec.current.stop();
  }, []);

  async function start() {
    if (!canRecord()) { setState("unsupported"); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("denied");
      return;
    }
    try {
      const mime = pickAudioType();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => {
        const type = mr.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        stream.getTracks().forEach((t) => t.stop());
        if (blob.size > 0) onAdd(blob, secsRef.current);
        setState("idle");
        setSecs(0);
        if (timer.current) clearInterval(timer.current);
      };
      rec.current = mr;
      mr.start();
      setState("recording");
      setSecs(0);
      secsRef.current = 0;
      timer.current = setInterval(() => {
        secsRef.current += 1;
        setSecs(secsRef.current);
        if (secsRef.current >= 300) stop(); // 5 min cap keeps uploads sane
      }, 1000);
    } catch {
      // the recorder itself refused (codec/device) — release the microphone
      // rather than leaving its indicator lit with nothing recording
      stream.getTracks().forEach((t) => t.stop());
      setState("unsupported");
    }
  }

  function stop() {
    if (rec.current && rec.current.state === "recording") rec.current.stop();
  }

  return (
    <div className={`ss-vm ${dark ? "dark" : ""}`}>
      {state === "recording" ? (
        <button className="ss-vm-btn rec" onClick={stop}>
          <span className="ss-vm-pulse" /> Stop · {mmss(secs)}
        </button>
      ) : (
        <button className="ss-vm-btn" onClick={start}>
          <Mic size={15} /> {memos.length ? "Record another" : "Record voice note"}
        </button>
      )}
      {state === "denied" && <span className="ss-vm-msg"><MicOff size={13} /> Microphone blocked — allow it in your browser settings</span>}
      {state === "unsupported" && <span className="ss-vm-msg"><MicOff size={13} /> Recording isn't supported here — type your note instead</span>}
      {memos.map((m, i) => (
        <span key={m.id} className="ss-vm-item">
          <Mic size={12} /> Voice note {i + 1} · {mmss(m.secs || 0)}
          <button onClick={() => onDelete(m.id)} aria-label="Delete voice note"><X size={13} /></button>
        </span>
      ))}
    </div>
  );
}

/* ================================================================== */

export default function SiteSnap() {
  const [screen, setScreen] = useState("loading"); // loading|home|setup|settings|board|walk|room|finish
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
  const [settingsReturn, setSettingsReturn] = useState("home"); // where Settings' back button goes
  const undoTimer = useRef(null);
  const originals = useRef({}); // id -> File/Blob (full quality, this session only)
  const audioCache = useRef({}); // memo id -> Blob
  const photoSeq = useRef(0);

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
    return p ? saveState(p.inspection, p.rooms) : Promise.resolve();
  }
  function flushPhotoSaves() {
    Object.values(photoTimers.current).forEach(clearTimeout);
    photoTimers.current = {};
    const batch = Object.entries(pendingPhotos.current);
    pendingPhotos.current = {};
    return Promise.all(batch.map(([id, caption]) => updatePhoto(id, { caption }).catch(() => {})));
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, saveNow.current ? 0 : 250);
    saveNow.current = false;
  }, [inspection, rooms]);

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
      // ask the browser not to evict an inspection under disk pressure;
      // browsers usually grant this only once the app is on the home screen
      requestDurableStorage().then((granted) => setDurable(granted));
      setIndex(await loadIndex());
      setArchive(await loadArchive());
      loadFieldMode().then(setFieldMode);
      setScreen("home");
      // media left behind by an interrupted close/discard is unreachable
      // from any inspection and only wastes the phone's storage
      sweepOrphans(Date.now() - 60 * 1000).then((n) => { if (n) console.info(`removed ${n} orphaned media item(s)`); });
    })();
  }, []);

  async function refreshIndex() {
    setIndex(await loadIndex());
  }

  // Photos and voice notes stay on disk until an inspection is closed, so
  // opening one only pulls that property's media into memory.
  async function openInspection(id) {
    const data = await loadInspection(id);
    if (!data || !data.inspection) { await refreshIndex(); return; }
    suppressSaveId.current = null;
    setInspection(data.inspection);
    setRooms(data.rooms || []);
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
    }
    setPhotoCache(cache);
    audioCache.current = {};
    const memoIds = (data.rooms || []).flatMap((r) => (r.memos || []).map((m) => m.id));
    await Promise.all(memoIds.map(async (mid) => {
      const b = await loadAudio(mid);
      if (b) audioCache.current[mid] = b;
    }));
    originals.current = {};
    photoSeq.current = (data.rooms || []).flatMap((r) => r.photoIds)
      .reduce((m, pid) => Math.max(m, (cache[pid] && cache[pid].no) || 0), 0);
    setScreen("board");
  }

  // Leaves the property loaded on disk — the surveyor is moving to the next
  // job, not finishing this one.
  async function backToHome() {
    await flushAll();
    setInspection(null);
    setRooms([]);
    setPhotoCache({});
    originals.current = {};
    audioCache.current = {};
    photoSeq.current = 0;
    await refreshIndex();
    setScreen("home");
  }

  function startInspection(address, postcode, roomList, caseDetails) {
    const insp = { id: uid("insp"), address, postcode, startedAt: Date.now(), ...(caseDetails || {}) };
    const rms = roomList.map((r) => ({ id: r.id, name: r.name, photoIds: [] }));
    suppressSaveId.current = null;
    setInspection(insp);
    setRooms(rms);
    setPhotoCache({});
    originals.current = {};
    photoSeq.current = 0;
    setScreen("board");
  }

  async function addPhoto(roomId, dataUrl, originalFile, thumb) {
    // a running number across the property; a counter rather than a recount so
    // a fast burst of shots can't hand two photos the same number
    photoSeq.current = Math.max(
      photoSeq.current,
      rooms.reduce((n, r) => n + r.photoIds.length, 0)
    ) + 1;
    const no = photoSeq.current;
    const photo = { id: uid("ph"), roomId, no, caption: "", dataUrl, thumb: thumb || null, takenAt: Date.now() };
    if (originalFile) originals.current[photo.id] = originalFile;
    saveNow.current = true;
    setPhotoCache((c) => ({ ...c, [photo.id]: photo }));
    setRooms((prev) => prev.map((r) =>
      r.id === roomId ? { ...r, photoIds: [...r.photoIds, photo.id] } : r
    ));
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
    setRooms((prev) => prev.map((r) =>
      r.id === roomId ? { ...r, photoIds: r.photoIds.filter((id) => id !== photoId) } : r
    ));
    delete pendingPhotos.current[photoId];
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (undoItem) finalizeDelete(undoItem.photo.id); // a second delete settles the first
    setUndoItem({ photo, roomId });
    undoTimer.current = setTimeout(() => {
      setUndoItem(null);
      finalizeDelete(photoId);
    }, 5000);
  }

  function undoDelete() {
    if (!undoItem) return;
    const { photo, roomId } = undoItem;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setRooms((prev) => prev.map((r) =>
      r.id === roomId ? { ...r, photoIds: [...r.photoIds, photo.id] } : r
    ));
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
    setRooms((prev) => prev.map((r) =>
      r.id === roomId ? { ...r, memos: [...(r.memos || []), { id, secs, type: blob.type }] } : r
    ));
  }

  function deleteMemo(roomId, memoId) {
    setRooms((prev) => prev.map((r) =>
      r.id === roomId ? { ...r, memos: (r.memos || []).filter((m) => m.id !== memoId) } : r
    ));
    removeAudio(memoId);
    delete audioCache.current[memoId];
  }

  function setInspectionMeta(patch) {
    setInspection((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // A caption is typed one character at a time, and each photo record carries
  // its full-size image — so the write is debounced per photo rather than
  // rewriting a megabyte on every keystroke.
  function setPhotoCaption(photoId, caption) {
    setPhotoCache((c) => {
      const p = c[photoId];
      if (!p) return c;
      pendingPhotos.current[photoId] = caption;
      return { ...c, [photoId]: { ...p, caption } };
    });
    if (photoTimers.current[photoId]) clearTimeout(photoTimers.current[photoId]);
    photoTimers.current[photoId] = setTimeout(() => {
      delete photoTimers.current[photoId];
      if (photoId in pendingPhotos.current) {
        const caption = pendingPhotos.current[photoId];
        delete pendingPhotos.current[photoId];
        updatePhoto(photoId, { caption }).catch(() => {});
      }
    }, 400);
  }

  function setRoomMeta(roomId, patch) {
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r)));
  }

  function addRoom(name) {
    setRooms((prev) => [...prev, { id: uid("room"), name, photoIds: [] }]);
  }

  async function finishAndReset() {
    // nothing pending may be written back after the record is deleted, or the
    // inspection would reappear on the home screen as a zombie
    suppressSaveId.current = inspection.id;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    pendingSave.current = null;
    Object.values(photoTimers.current).forEach(clearTimeout);
    photoTimers.current = {};
    pendingPhotos.current = {};
    const ids = rooms.flatMap((r) => r.photoIds);
    const memoIds = rooms.flatMap((r) => (r.memos || []).map((m) => m.id));
    await archiveInspection({
      id: inspection.id,
      address: inspection.address,
      postcode: inspection.postcode || "",
      ref: inspection.ref || "",
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
    memoIds.forEach((id) => removeAudio(id));
    await backToHome();
  }

  // Discards a whole property from the list without opening it.
  async function discardInspection(id) {
    const data = await loadInspection(id);
    if (data && data.rooms) {
      data.rooms.flatMap((r) => r.photoIds).forEach((pid) => removePhoto(pid));
      data.rooms.flatMap((r) => (r.memos || []).map((m) => m.id)).forEach((mid) => removeAudio(mid));
    }
    await clearState(id);
    await refreshIndex();
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
        const ext = (orig.type && orig.type.split("/")[1]) || "jpg";
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

  return (
    <div className={`ss-root${fieldMode ? " ss-field" : ""}`}>
      <StyleBlock />
      <div className="ss-frame">
        {screen === "loading" && (
          <div className="ss-center"><Loader2 className="ss-spin" size={26} /></div>
        )}

        {screen === "home" && (
          <HomeScreen
            index={index}
            archive={archive}
            durable={durable}
            onNew={() => setScreen("setup")}
            onOpen={openInspection}
            onDiscard={discardInspection}
            onSettings={() => { setSettingsReturn("home"); setScreen("settings"); }}
          />
        )}

        {screen === "setup" && (
          <SetupScreen onBack={() => setScreen("home")} onStart={startInspection} />
        )}

        {screen === "settings" && (
          <SettingsScreen
            onBack={() => setScreen(settingsReturn)}
            fieldMode={fieldMode}
            onToggleFieldMode={toggleFieldMode}
          />
        )}

        {screen === "board" && inspection && (
          <BoardScreen
            inspection={inspection}
            rooms={rooms}
            photoCache={photoCache}
            totalPhotos={totalPhotos}
            doneRooms={doneRooms}
            onReorder={reorderRooms}
            onAddRoom={addRoom}
            onHome={backToHome}
            onRename={(patch) => setInspectionMeta(patch)}
            onOpenRoom={(id) => { setActiveRoomId(id); setScreen("room"); }}
            onWalk={(startIdx) => { setWalkIndex(startIdx); setScreen("walk"); }}
            onFinish={() => setScreen("finish")}
          />
        )}

        {screen === "walk" && inspection && rooms[walkIndex] && (
          <WalkScreen
            rooms={rooms}
            index={walkIndex}
            photoCache={photoCache}
            onIndex={setWalkIndex}
            onCapture={(dataUrl, file, thumb) => addPhoto(rooms[walkIndex].id, dataUrl, file, thumb)}
            onError={setStorageAlert}
            onDeleteLast={() => {
              const r = rooms[walkIndex];
              const last = r.photoIds[r.photoIds.length - 1];
              if (last) deletePhoto(r.id, last);
            }}
            onMeta={(patch) => setRoomMeta(rooms[walkIndex].id, patch)}
            onAddMemo={(blob, secs) => addMemo(rooms[walkIndex].id, blob, secs)}
            onDeleteMemo={(mid) => deleteMemo(rooms[walkIndex].id, mid)}
            onExit={() => setScreen("board")}
          />
        )}

        {screen === "room" && (() => {
          const room = rooms.find((r) => r.id === activeRoomId);
          if (!room) { setScreen("board"); return null; }
          return (
            <RoomScreen
              room={room}
              photos={room.photoIds.map((id) => photoCache[id]).filter(Boolean)}
              onBack={() => setScreen("board")}
              onCapture={(dataUrl, file, thumb) => addPhoto(room.id, dataUrl, file, thumb)}
              onError={setStorageAlert}
              onDelete={(pid) => deletePhoto(room.id, pid)}
              onMeta={(patch) => setRoomMeta(room.id, patch)}
              onCaption={setPhotoCaption}
              onFull={fullPhoto}
              onAnnotate={annotatePhoto}
              onAddMemo={(blob, secs) => addMemo(room.id, blob, secs)}
              onDeleteMemo={(mid) => deleteMemo(room.id, mid)}
              onSaveToPhotos={async () => shareFiles(await filesFor(room), `${room.name} photos`)}
            />
          );
        })()}

        {screen === "finish" && inspection && (
          <FinishScreen
            inspection={inspection}
            rooms={rooms}
            photoCache={photoCache}
            totalPhotos={totalPhotos}
            filesForRoom={(room) => filesFor(room)}
            filesForUpload={(room) => filesFor(room, true)}
            fullPhoto={fullPhoto}
            audioCache={audioCache}
            onUploadResult={(r) => setInspectionMeta({ lastUpload: r })}
            onExportResult={(r) => setInspectionMeta({ lastExport: r })}
            onFindings={(f) => setInspectionMeta({ draftFindings: f })}
            onBack={() => setScreen("board")}
            onSaveAll={async () => shareFiles(await filesForAll(), "Inspection photos")}
            onDone={finishAndReset}
            onSettings={() => { setSettingsReturn("finish"); setScreen("settings"); }}
          />
        )}

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
      </div>
    </div>
  );
}

/* ---------------- home ---------------- */

function HomeScreen({ index, archive, durable, onNew, onOpen, onDiscard, onSettings }) {
  const [confirmId, setConfirmId] = useState(null);
  const [q, setQ] = useState("");
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const target = open.find((i) => i.id === confirmId);

  const done = archive || [];
  const needle = q.trim().toLowerCase();
  const matches = (i) => !needle || [i.address, i.ref, i.postcode].filter(Boolean).join(" ").toLowerCase().includes(needle);
  const openShown = open.filter(matches);
  const doneShown = done.filter(matches);

  if (open.length === 0 && done.length === 0) {
    return (
      <div className="ss-col">
        <div className="ss-home-top">
          <span />
          <button className="ss-icon-btn" onClick={onSettings} aria-label="Settings" title="Settings"><SettingsIcon size={17} /></button>
        </div>
        <div className="ss-home-hero">
          <div className="ss-mark"><Camera size={20} strokeWidth={2.4} /></div>
          <div className="ss-eyebrow">Property inspections</div>
          <h1 className="ss-h1">Every photo,<br />already filed.</h1>
          <p className="ss-lede">
            Pick the rooms, walk the property, shoot as you go. Photos file
            themselves into numbered room folders — rate each room, add notes,
            and export everything in one tap at the end.
          </p>
          <div className="ss-home-steps">
            <div><span className="ss-step-n">1</span> Set up the property</div>
            <div><span className="ss-step-n">2</span> Walk, shoot &amp; rate each room</div>
            <div><span className="ss-step-n">3</span> Export — Photos, ZIP, OneDrive, PDF report</div>
          </div>
        </div>
        <div className="ss-footer">
          <button className="ss-btn ss-btn-primary ss-btn-big" onClick={onNew}>
            <Plus size={20} strokeWidth={2.6} /> New inspection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ss-col">
      <div className="ss-topbar">
        <span className="ss-tick" />
        <div className="ss-topbar-text">
          <div className="ss-eyebrow-sm">SiteSnap</div>
          <div className="ss-title">In progress</div>
        </div>
        <span className="ss-badge">{open.length}</span>
        <button className="ss-icon-btn" onClick={onSettings} aria-label="Settings" title="Settings"><SettingsIcon size={16} /></button>
      </div>

      <div className="ss-search-row">
        <Search size={15} className="ss-search-ic" />
        <input className="ss-search-input" placeholder="Search address, ref, postcode…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="ss-search-clear" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
      </div>

      <div className="ss-scroll">
        {needle && openShown.length === 0 && doneShown.length === 0 && (
          <p className="ss-empty-note">Nothing matches “{q.trim()}”.</p>
        )}
        <div className="ss-list">
          {openShown.map((i) => (
            <div key={i.id} className="ss-row">
              <button className="ss-row-tap" onClick={() => onOpen(i.id)}>
                <div className="ss-row-main ss-job">
                  <span className="ss-row-name">{i.address}</span>
                  <span className="ss-job-sub">
                    {i.ref ? i.ref + " · " : i.postcode ? i.postcode + " · " : ""}
                    {i.photos} photo{i.photos === 1 ? "" : "s"} · {i.rooms} area{i.rooms === 1 ? "" : "s"}
                    {" · "}{relativeDay(i.startedAt)}
                  </span>
                  {i.lastUpload && (
                    <span className={`ss-job-up ${i.lastUpload.ok ? "ok" : "bad"}`} title={
                      i.lastUpload.ok
                        ? (i.lastUpload.confirmed ? "Confirmed as filed by your cloud workflow" : "Sent, but your workflow hasn't confirmed it's filed yet")
                        : "The last upload attempt didn't finish — open this inspection to retry"
                    }>
                      {i.lastUpload.ok ? <CircleCheck size={11} /> : <X size={11} />}
                      {i.lastUpload.ok ? (i.lastUpload.confirmed ? "Filed" : "Sent, not confirmed") : "Upload incomplete"}
                    </span>
                  )}
                </div>
              </button>
              <button className="ss-job-x" onClick={() => setConfirmId(i.id)} aria-label={`Discard ${i.address}`} title="Discard this inspection">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        {durable === false && (
          <div className="ss-tip">
            <Smartphone size={14} />
            <span>
              Add SiteSnap to your home screen (Share → Add to Home Screen). It
              stops the browser clearing photos you haven't uploaded yet.
            </span>
          </div>
        )}
        {open.length === 0 && !needle && (
          <p className="ss-empty-note">Nothing in progress. Start a new inspection below.</p>
        )}

        {doneShown.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 22 }}>Completed</div>
            <div className="ss-list">
              {doneShown.slice(0, 25).map((a) => (
                <div key={a.id} className="ss-row ss-row-done">
                  <div className="ss-row-tap">
                    <div className="ss-row-main ss-job">
                      <span className="ss-row-name">{a.address}</span>
                      <span className="ss-job-sub">
                        {a.ref ? a.ref + " · " : ""}{a.photos} photo{a.photos === 1 ? "" : "s"}
                        {" · closed "}{relativeDay(a.closedAt)}
                      </span>
                      <span className={`ss-job-up ${a.lastUpload && a.lastUpload.confirmed ? "ok" : a.lastUpload ? "warn" : "bad"}`} title={
                        a.lastUpload
                          ? (a.lastUpload.confirmed ? "Your cloud workflow confirmed every file was filed" : "The upload was accepted but never confirmed as filed — worth checking OneDrive")
                          : a.lastExport ? "Saved as a ZIP or to Photos, but never sent to the cloud" : "This inspection was closed without exporting or uploading it anywhere"
                      }>
                        {a.lastUpload
                          ? (a.lastUpload.confirmed ? <><CircleCheck size={11} /> Filed in the cloud</> : <><CloudUpload size={11} /> Sent, not confirmed</>)
                          : a.lastExport ? <><Download size={11} /> Exported only</> : <><X size={11} /> Never uploaded</>}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="ss-fineprint">
          Inspections stay on this device until you export and close them, so you
          can run several properties in a day and upload when you have signal.
          Closing one keeps this record but removes its photos from the phone.
        </p>
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-primary ss-btn-big" onClick={onNew}>
          <Plus size={20} strokeWidth={2.6} /> New inspection
        </button>
      </div>

      {target && (
        <div className="ss-modal-back" onClick={() => setConfirmId(null)}>
          <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ss-modal-icon"><AlertTriangle size={22} /></div>
            <div className="ss-modal-title">Discard {target.address}?</div>
            <p>
              Its {target.photos} photo{target.photos === 1 ? "" : "s"} and notes will be
              deleted from this device. Anything already exported or uploaded is unaffected.
            </p>
            <button className="ss-btn ss-btn-danger"
              onClick={() => { onDiscard(target.id); setConfirmId(null); }}>
              <Trash2 size={16} /> Delete inspection
            </button>
            <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }} onClick={() => setConfirmId(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function relativeDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ---------------- settings ---------------- */

function CloudProviderCard({ label, icon, connected, connecting, account, clientId, onClientId, onConnect, onDisconnect, error, portalHint, builtIn }) {
  return (
    <div className="ss-cloud-card">
      <div className="ss-cloud-head">
        <span className="ss-cloud-ic">{icon}</span>
        <span className="ss-cloud-label">{label}</span>
        {connected && <span className="ss-cloud-connected"><CircleCheck size={12} /> Connected{account ? ` — ${account}` : ""}</span>}
      </div>
      {/* builtIn: whoever runs this deployment already registered an app and
          baked its client ID in — every surveyor using it just signs in,
          with no ID to find or paste. Falls back to manual entry when
          nobody's done that (e.g. someone running their own copy). */}
      {!connected && !builtIn && (
        <>
          <input
            className="ss-input" placeholder="App (client) ID"
            value={clientId} onChange={(e) => onClientId(e.target.value)}
            autoCapitalize="none" autoComplete="off"
          />
          <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>{portalHint}</p>
        </>
      )}
      {error && <p className="ss-fineprint" style={{ color: "var(--red)", margin: "6px 2px 0" }}>{error}</p>}
      <button
        className={`ss-btn ${connected ? "ss-btn-ghost" : "ss-btn-primary"}`}
        style={{ marginTop: 10 }}
        disabled={connecting || (!connected && !clientId.trim())}
        onClick={connected ? onDisconnect : onConnect}
      >
        {connecting ? <Loader2 size={16} className="ss-spin" /> : connected ? "Disconnect" : `Connect ${label}`}
      </button>
    </div>
  );
}

function SettingsScreen({ onBack, fieldMode, onToggleFieldMode }) {
  const [hookUrl, setHookUrl] = useState("");
  const [hookKey, setHookKey] = useState("");
  const [savedNote, setSavedNote] = useState(null);

  const [msClientId, setMsClientId] = useState("");
  const [msAccountName, setMsAccountName] = useState(null);
  const [msBusy, setMsBusy] = useState(false);
  const [msError, setMsError] = useState(null);

  const [googleClientId, setGoogleClientId] = useState("");
  const [googleOn, setGoogleOn] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState(null);

  const [storage, setStorage] = useState(null);
  const [durable, setDurable] = useState(null);

  useEffect(() => {
    loadWebhook().then((u) => setHookUrl(u || ""));
    loadWebhookKey().then((k) => setHookKey(k || ""));
    loadMsClientId().then(async (id) => {
      setMsClientId(id || "");
      // MSAL's cache lives in localStorage, so a returning surveyor can
      // already be signed in — only pull the library in if there's an ID
      // to check against.
      if (!id) return;
      const { msAccount } = await loadMsGraph();
      const acc = await msAccount(id);
      if (acc) setMsAccountName(acc.username);
    });
    // Google's access token is memory-only (see cloud/googleDrive.js) and
    // doesn't survive a reload on its own — but if the browser still has a
    // live Google session, a silent (no-popup) request usually gets a new
    // one without asking the surveyor to sign in again every time.
    loadGoogleClientId().then(async (id) => {
      setGoogleClientId(id || "");
      if (!id) return;
      const { trySilentGoogleReconnect } = await loadGoogleDrive();
      setGoogleOn(await trySilentGoogleReconnect(id));
    });
    storageEstimate().then(setStorage);
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(setDurable);
  }, []);

  function flash(msg) { setSavedNote(msg); setTimeout(() => setSavedNote(null), 2500); }

  async function saveHook() {
    await saveWebhook(hookUrl.trim());
    await saveWebhookKey(hookKey.trim());
    flash("Cloud upload link saved");
  }

  async function connectMs() {
    setMsBusy(true); setMsError(null);
    try {
      await saveMsClientId(msClientId.trim());
      const { connectOneDrive } = await loadMsGraph();
      const acc = await connectOneDrive(msClientId.trim());
      setMsAccountName(acc.username);
      flash("OneDrive connected");
    } catch (e) {
      setMsError(e && e.message ? e.message : "Couldn't connect to OneDrive.");
    } finally { setMsBusy(false); }
  }
  async function disconnectMs() {
    setMsBusy(true);
    const { disconnectOneDrive } = await loadMsGraph();
    await disconnectOneDrive(msClientId.trim());
    setMsAccountName(null);
    setMsBusy(false);
  }

  async function connectGoogle() {
    setGoogleBusy(true); setGoogleError(null);
    try {
      await saveGoogleClientId(googleClientId.trim());
      const { connectGoogleDrive } = await loadGoogleDrive();
      await connectGoogleDrive(googleClientId.trim());
      setGoogleOn(true);
      flash("Google Drive connected");
    } catch (e) {
      setGoogleError(e && e.message ? e.message : "Couldn't connect to Google Drive.");
    } finally { setGoogleBusy(false); }
  }
  async function disconnectGoogle() {
    const { disconnectGoogleDrive } = await loadGoogleDrive();
    disconnectGoogleDrive();
    setGoogleOn(false);
  }

  return (
    <div className="ss-col">
      <TopBar title="Settings" eyebrow="SiteSnap" onBack={onBack} />
      <div className="ss-scroll">
        <div className="ss-section-label" style={{ marginTop: 4 }}>Direct cloud link</div>
        <p className="ss-fineprint" style={{ margin: "0 2px 10px" }}>
          Sign in with your own Microsoft or Google account and SiteSnap writes
          straight into your OneDrive or Drive — no Make/n8n/Zapier scenario
          needed. Requires a free app registration in Azure or Google Cloud;
          see the setup guide in the repo's docs.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CloudProviderCard
            label="OneDrive" icon={<CloudUpload size={16} />}
            connected={!!msAccountName} connecting={msBusy} account={msAccountName}
            clientId={msClientId} onClientId={setMsClientId}
            onConnect={connectMs} onDisconnect={disconnectMs} error={msError}
            builtIn={hasBuiltInMsClientId()}
            portalHint="From portal.azure.com → App registrations → New registration (SPA, redirect URI = this app's URL)."
          />
          <CloudProviderCard
            label="Google Drive" icon={<CloudUpload size={16} />}
            connected={googleOn} connecting={googleBusy} account={null}
            clientId={googleClientId} onClientId={setGoogleClientId}
            onConnect={connectGoogle} onDisconnect={disconnectGoogle} error={googleError}
            builtIn={hasBuiltInGoogleClientId()}
            portalHint="From console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web application)."
          />
        </div>

        <div className="ss-section-label" style={{ marginTop: 20 }}>Cloud upload via Make / n8n / Zapier</div>
        <input
          className="ss-input" placeholder="https://your-n8n.app/webhook/inspections"
          value={hookUrl} onChange={(e) => setHookUrl(e.target.value)}
          inputMode="url" autoCapitalize="none"
        />
        <div className="ss-key-row" style={{ marginTop: 8 }}>
          <KeyRound size={14} />
          <input
            className="ss-input" placeholder="Access key (optional)"
            value={hookKey} onChange={(e) => setHookKey(e.target.value)}
            autoCapitalize="none" autoComplete="off"
          />
        </div>
        <p className="ss-fineprint" style={{ margin: "8px 2px 0" }}>
          Photos, voice notes and a site-notes file are POSTed with the address
          and folder name, and your workflow files them into OneDrive or
          Google Drive. Set an access key here and in your webhook so only
          this phone can upload.
        </p>
        <button className="ss-btn ss-btn-primary" style={{ marginTop: 10 }} onClick={saveHook}>Save link</button>

        <div className="ss-section-label" style={{ marginTop: 20 }}>Display</div>
        <div className="ss-settings-row">
          <span className="ss-settings-ic">{fieldMode ? <Moon size={17} /> : <Sun size={17} />}</span>
          <div style={{ flex: 1 }}>
            <div className="ss-settings-title">Field mode</div>
            <div className="ss-settings-sub">High-contrast dark theme for bright daylight</div>
          </div>
          <button
            className={`ss-toggle ${fieldMode ? "on" : ""}`}
            role="switch" aria-checked={fieldMode} onClick={onToggleFieldMode}
          ><span /></button>
        </div>

        <div className="ss-section-label" style={{ marginTop: 20 }}>Storage on this phone</div>
        <div className="ss-storage-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HardDrive size={15} color={durable ? "var(--pine)" : "var(--amber)"} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {durable === null ? "Checking storage…" : durable ? "Durable storage granted" : "Durable storage not granted yet"}
            </span>
          </div>
          {storage && storage.quota ? (
            <>
              <div className="ss-progress" style={{ marginTop: 10 }}>
                <div style={{ width: `${Math.min(100, Math.round((storage.usage / storage.quota) * 100))}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                <span>{Math.round(storage.usage / 1048576)} MB used</span>
                <span>{storage.freeMB} MB free</span>
              </div>
            </>
          ) : (
            <p className="ss-fineprint" style={{ margin: "8px 2px 0" }}>This browser doesn't report storage usage.</p>
          )}
        </div>

        <div className="ss-section-label" style={{ marginTop: 20 }}>About</div>
        <div className="ss-storage-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>SiteSnap</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Version 2.1.0</span>
        </div>

        {savedNote && <div className="ss-note" style={{ marginTop: 10 }}>{savedNote}</div>}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

/* ---------------- setup (one screen) ---------------- */

function SetupScreen({ onBack, onStart }) {
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [items, setItems] = useState([]); // {id, base, custom?}
  const [customName, setCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [ref, setRef] = useState("");
  const [client, setClient] = useState("");
  const [occupier, setOccupier] = useState("");
  const [solicitor, setSolicitor] = useState("");

  const countOf = (base) => items.filter((i) => i.base === base).length;

  function inc(base) { setItems((p) => [...p, { id: uid("room"), base }]); }
  function dec(base) {
    setItems((p) => {
      const idx = p.map((i) => i.base).lastIndexOf(base);
      if (idx === -1) return p;
      const n = [...p]; n.splice(idx, 1); return n;
    });
  }
  function toggle(base) { countOf(base) ? dec(base) : inc(base); }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    setItems((p) => [...p, { id: uid("room"), base: name, custom: true }]);
    setCustomName("");
    setAddingCustom(false);
  }

  // display names: number duplicates in walk order
  const named = (() => {
    const totals = {};
    items.forEach((i) => { totals[i.base] = (totals[i.base] || 0) + 1; });
    const seen = {};
    return items.map((i) => {
      seen[i.base] = (seen[i.base] || 0) + 1;
      return { ...i, name: totals[i.base] > 1 ? `${i.base} ${seen[i.base]}` : i.base };
    });
  })();

  const canStart = address.trim().length > 0 && items.length > 0;

  return (
    <div className="ss-col">
      <TopBar title="New inspection" eyebrow="Set up once, then just shoot" onBack={onBack} />

      <div className="ss-scroll">
        <div className="ss-section-label">Property</div>
        <input
          className="ss-input" autoFocus placeholder="23 High Street"
          value={address} onChange={(e) => setAddress(e.target.value)}
        />
        <input
          className="ss-input" placeholder="Postcode (optional)" style={{ marginTop: 8 }}
          value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())}
        />

        <button className="ss-case-toggle" onClick={() => setCaseOpen((o) => !o)}>
          <Briefcase size={13} />
          {caseOpen ? "Hide case details" : "Add case details (optional)"}
        </button>
        {caseOpen && (
          <div className="ss-case">
            <input className="ss-input" placeholder="Your reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            <input className="ss-input" placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
            <input className="ss-input" placeholder="Occupier / tenant" value={occupier} onChange={(e) => setOccupier(e.target.value)} />
            <input className="ss-input" placeholder="Instructing solicitor" value={solicitor} onChange={(e) => setSolicitor(e.target.value)} />
            <p className="ss-fineprint" style={{ margin: "4px 2px 0" }}>
              Carried into the report, the ZIP and the cloud upload, so they don't
              have to be typed into the spreadsheet again.
            </p>
          </div>
        )}

        <div className="ss-section-label" style={{ marginTop: 20 }}>
          Rooms &amp; areas <span className="ss-hint">— tap to add; use +/− for bedrooms, bathrooms &amp; extra claim items</span>
        </div>
        <input
          className="ss-input ss-filter" placeholder="Filter areas…"
          value={filter} onChange={(e) => setFilter(e.target.value)}
        />
        <div className="ss-chip-grid">
          {PRESETS
            .filter((p) => p.base.toLowerCase().includes(filter.trim().toLowerCase()))
            .sort((a, b) => a.base.localeCompare(b.base))
            .map((p) => {
              const c = countOf(p.base);
              return (
                <div key={p.base} className={`ss-chip ${c ? "on" : ""}`}>
                  <button className="ss-chip-main" onClick={() => (p.steppable ? (c ? null : inc(p.base)) : toggle(p.base))}>
                    {p.base}{c > 1 ? ` ×${c}` : ""}
                  </button>
                  {p.steppable ? (
                    c > 0 ? (
                      <span className="ss-stepper">
                        <button onClick={() => dec(p.base)} aria-label={`Remove ${p.base}`}><Minus size={14} /></button>
                        <button onClick={() => inc(p.base)} aria-label={`Add ${p.base}`}><Plus size={14} /></button>
                      </span>
                    ) : null
                  ) : c > 0 ? (
                    <Check size={15} className="ss-chip-check" />
                  ) : null}
                </div>
              );
            })}
        </div>

        {addingCustom ? (
          <div className="ss-inline-add">
            <input
              className="ss-input" autoFocus placeholder="e.g. Utility Room"
              value={customName} onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
            />
            <button className="ss-btn ss-btn-primary ss-btn-sq" onClick={addCustom}><Check size={18} /></button>
          </div>
        ) : (
          <button className="ss-dashed" onClick={() => setAddingCustom(true)}>
            <Plus size={15} /> Add custom area
          </button>
        )}

        {named.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 20 }}>
              Walk order <span className="ss-hint">— drag to match your route; sets folder numbering</span>
            </div>
            <ReorderableList
              items={named}
              onReorder={(next) => setItems(next.map(({ id, base, custom }) => ({ id, base, custom })))}
              renderRow={(item, index) => (
                <div className="ss-row-main">
                  <span className="ss-index">{pad(index + 1)}</span>
                  <span className="ss-row-name">{item.name}</span>
                </div>
              )}
            />
          </>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer ss-footer-split">
        <span className="ss-count-note">{items.length} area{items.length === 1 ? "" : "s"}</span>
        <button className="ss-btn ss-btn-primary" disabled={!canStart}
          title={!address.trim() ? "Enter the property address first" : items.length === 0 ? "Pick at least one room or area" : undefined}
          onClick={() => onStart(address.trim(), postcode.trim(), named, {
            ref: ref.trim(), client: client.trim(),
            occupier: occupier.trim(), solicitor: solicitor.trim(),
          })}>
          Start inspection <ArrowRight size={17} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- board (overview) ---------------- */

function BoardScreen({ inspection, rooms, photoCache, totalPhotos, doneRooms, onReorder, onAddRoom, onRename, onHome, onOpenRoom, onWalk, onFinish }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState({ address: "", postcode: "" });
  const [name, setName] = useState("");
  const firstEmpty = Math.max(0, rooms.findIndex((r) => r.photoIds.length === 0));
  const pct = rooms.length ? Math.round((doneRooms / rooms.length) * 100) : 0;

  return (
    <div className="ss-col">
      <TopBar
        title={inspection.address}
        eyebrow={inspection.postcode || "Inspection in progress"}
        onBack={onHome}
        right={
          <button className="ss-link" title="Edit the address or postcode" onClick={() => {
            setDraft({ address: inspection.address, postcode: inspection.postcode || "" });
            setRenaming(true);
          }}>
            <Pencil size={13} /> Edit
          </button>
        }
      />

      {renaming && (
        <div className="ss-modal-back" onClick={() => setRenaming(false)}>
          <div className="ss-modal ss-modal-left" onClick={(e) => e.stopPropagation()}>
            <div className="ss-modal-title">Property details</div>
            <input className="ss-input" autoFocus placeholder="Address"
              value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            <input className="ss-input" style={{ marginTop: 8 }} placeholder="Postcode"
              value={draft.postcode} onChange={(e) => setDraft({ ...draft, postcode: e.target.value.toUpperCase() })} />
            <p className="ss-fineprint" style={{ margin: "10px 2px 14px" }}>
              Photos already uploaded keep the old folder name — rename before
              uploading, or move that folder in OneDrive afterwards.
            </p>
            <button className="ss-btn ss-btn-primary" disabled={!draft.address.trim()}
              title={!draft.address.trim() ? "Address can't be empty" : undefined}
              onClick={() => { onRename({ address: draft.address.trim(), postcode: draft.postcode.trim() }); setRenaming(false); }}>
              Save
            </button>
            <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }} onClick={() => setRenaming(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="ss-progress-wrap">
        <div className="ss-progress"><div style={{ width: `${pct}%` }} /></div>
        <span>{doneRooms}/{rooms.length} rooms covered</span>
      </div>

      <div className="ss-scroll">
        <ReorderableList
          items={rooms}
          onReorder={onReorder}
          onRowTap={(room) => onOpenRoom(room.id)}
          renderRow={(room, index) => {
            const lastId = room.photoIds[room.photoIds.length - 1];
            const thumb = lastId ? photoCache[lastId] : null;
            return (
              <>
                <div className="ss-row-main">
                  <span className="ss-index">{pad(index + 1)}</span>
                  <span className="ss-row-name">{room.name}</span>
                  {room.condition && <span className={`ss-cdot ${room.condition.toLowerCase()}`} title={room.condition} />}
                  {room.note ? <StickyNote size={12} className="ss-note-flag" /> : null}
                </div>
                <span className="ss-row-right">
                  {thumb ? (
                    <img src={thumb.thumb || thumb.dataUrl} alt="" className="ss-thumb" />
                  ) : (
                    <span className="ss-thumb ss-thumb-empty"><ImageIcon size={13} /></span>
                  )}
                  <span className={`ss-pill ${room.photoIds.length ? "done" : ""}`}>
                    {room.photoIds.length ? room.photoIds.length : "—"}
                  </span>
                </span>
              </>
            );
          }}
        />

        {adding ? (
          <div className="ss-inline-add">
            <input className="ss-input" autoFocus placeholder="Room name" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onAddRoom(name.trim()); setName(""); setAdding(false); } }} />
            <button className="ss-btn ss-btn-primary ss-btn-sq"
              onClick={() => { if (name.trim()) onAddRoom(name.trim()); setName(""); setAdding(false); }}>
              <Check size={18} />
            </button>
          </div>
        ) : (
          <button className="ss-dashed" onClick={() => setAdding(true)}><Plus size={15} /> Add room</button>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer ss-footer-stack">
        <button className="ss-btn ss-btn-live ss-btn-big" onClick={() => onWalk(firstEmpty)}>
          <Camera size={20} strokeWidth={2.4} />
          {totalPhotos === 0 ? "Start walkthrough" : "Continue walkthrough"}
        </button>
        <button className="ss-btn ss-btn-ghost" onClick={onFinish}>
          <FolderTree size={17} /> Finish &amp; export
        </button>
      </div>
    </div>
  );
}

/* ---------------- walkthrough capture ---------------- */

/* ---------------- in-page live camera ---------------- */
// A native camera app hand-off is safe but slow: each shot leaves the page,
// and the round trip is what made shooting feel like "snap, click Use Photo,
// wait for the camera to reopen". This runs the camera feed inline instead —
// tap the shutter, the frame is grabbed straight off the video element, the
// feed never stops. Falls back to the native picker (via onFallback) if the
// browser or device won't cooperate, so shooting never dead-ends.
function LiveCamera({ label, count, onCapture, onClose, onFallback }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const [state, setState] = useState("starting"); // starting|ready|denied|busy|unsupported
  const [flash, setFlash] = useState(false);
  const [justTaken, setJustTaken] = useState(null); // small data URL of the last frame
  const capturing = useRef(false);
  const alive = useRef(true);
  const opening = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startStream() {
    if (opening.current) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setState("unsupported");
      return;
    }
    opening.current = true;
    setState("starting");
    const constraints = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: PHOTO_DIM }, height: { ideal: PHOTO_DIM } }, audio: false },
      { video: true, audio: false }, // older devices reject exact/ideal facingMode
    ];
    try {
      for (const c of constraints) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(c);
          // closed, or backgrounded, while the permission prompt was up
          if (!alive.current || document.hidden) { stream.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
          setState("ready");
          return;
        } catch (e) {
          // permission or hardware problems won't be fixed by a looser
          // constraint, so stop immediately rather than prompting again
          if (e && e.name === "NotAllowedError") { if (alive.current) setState("denied"); return; }
          if (e && e.name === "NotReadableError") { if (alive.current) setState("busy"); return; }
          // otherwise (e.g. OverconstrainedError) try the next constraint
        }
      }
      if (alive.current) setState("unsupported");
    } finally {
      opening.current = false;
    }
  }

  useEffect(() => {
    alive.current = true;
    startStream();
    return () => { alive.current = false; stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // A feed left running in a backgrounded tab drains the battery and keeps
    // the camera indicator lit. Stopping it also freezes the last frame in
    // the <video>, so the shutter must be taken away until the feed is
    // running again — otherwise a tap "captures" a frame from ten minutes ago.
    function onVis() {
      if (document.hidden) {
        stopStream();
        if (stateRef.current === "ready") setState("starting");
      } else if (!streamRef.current && stateRef.current === "starting") {
        startStream();
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || state !== "ready" || capturing.current) return;
    // no decoded frame yet (the first few ms after the feed starts)
    if (!video.videoWidth || !video.videoHeight) return;
    capturing.current = true;
    setFlash(true);
    setTimeout(() => setFlash(false), 130);
    const w = video.videoWidth, h = video.videoHeight;
    const canvas = canvasRef.current || (canvasRef.current = document.createElement("canvas"));
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    // the stored copy and the thumbnail come straight off this canvas — no
    // encode → decode → re-encode round trip per shot
    let dataUrl, thumb;
    try {
      dataUrl = drawScaled(canvas, w, h, PHOTO_DIM, 0.87);
      thumb = drawScaled(canvas, w, h, THUMB_DIM, 0.72);
    } catch (e) {
      capturing.current = false;
      console.error(e);
      return;
    }
    setJustTaken(thumb);
    canvas.toBlob((blob) => {
      capturing.current = false;
      // the full-resolution frame is kept as the session "original" for
      // full-quality exports; if the encoder fails the stored copy still lands
      const file = blob ? new File([blob], `shot_${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
      onCapture(dataUrl, file, thumb);
    }, "image/jpeg", 0.92);
  }

  function close() {
    stopStream();
    onClose();
  }

  const broken = state === "denied" || state === "busy" || state === "unsupported";

  return (
    <div className="ss-livecam">
      <video ref={videoRef} className="ss-livecam-video" autoPlay muted playsInline />
      {flash && <div className="ss-livecam-flash" />}

      <div className="ss-livecam-top">
        <button className="ss-livecam-close" onClick={close}><X size={20} /></button>
        <span className="ss-livecam-label">{label}</span>
        <span className="ss-livecam-count">{count}</span>
      </div>

      {state === "starting" && (
        <div className="ss-livecam-msg"><Loader2 size={22} className="ss-spin" /><span>Opening camera…</span></div>
      )}

      {broken && (
        <div className="ss-livecam-msg">
          <Aperture size={22} />
          <span>
            {state === "denied" && "Camera access was blocked — allow it in your browser settings, or use the phone's own camera."}
            {state === "busy" && "Another app is using the camera right now."}
            {state === "unsupported" && "The live camera isn't available here."}
          </span>
          <button className="ss-livecam-fallback" onClick={() => { stopStream(); onFallback(); }}>
            <Camera size={15} /> Use phone's camera instead
          </button>
        </div>
      )}

      {state === "ready" && (
        <div className="ss-livecam-bottom">
          {justTaken && <img className="ss-livecam-last" src={justTaken} alt="" />}
          <button className="ss-livecam-shutter" onClick={capture} aria-label="Take photo" />
          <button className="ss-livecam-switch" onClick={() => { stopStream(); onFallback(); }} aria-label="Use phone's camera app instead" title="Use phone's camera app instead">
            <RefreshCw size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

const BAD_IMAGE_MSG = "That image couldn't be read, so it wasn't added — try the shot again.";

function WalkScreen({ rooms, index, photoCache, onIndex, onCapture, onDeleteLast, onMeta, onAddMemo, onDeleteMemo, onExit, onError }) {
  const inputRef = useRef(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const room = rooms[index];
  const count = room.photoIds.length;
  const lastId = room.photoIds[count - 1];
  const last = lastId ? photoCache[lastId] : null;
  const isLast = index === rooms.length - 1;

  useEffect(() => { setNoteOpen(false); setCameraOpen(false); }, [index]);

  function openCamera() {
    setCameraOpen(true);
  }

  async function handleFile(e) {
    // Some cameras and the gallery hand back several files at once; take them
    // all, in the order chosen.
    const files = Array.from((e.target.files) || []);
    e.target.value = "";
    for (const file of files) {
      try {
        const { dataUrl, thumb } = await processCapture(file);
        onCapture(dataUrl, file, thumb);
      } catch (err) {
        console.error(err);
        onError && onError(BAD_IMAGE_MSG);
      }
    }
  }

  return (
    <div className="ss-col ss-live">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple
        className="ss-hidden" onChange={handleFile} />

      {cameraOpen && (
        <LiveCamera
          label={room.name}
          count={count}
          onCapture={onCapture}
          onClose={() => setCameraOpen(false)}
          onFallback={() => { setCameraOpen(false); inputRef.current && inputRef.current.click(); }}
        />
      )}

      <div className="ss-live-top">
        <button className="ss-live-exit" onClick={onExit}><X size={18} /> Exit</button>
        <span className="ss-live-flag">● LIVE</span>
      </div>

      <div className="ss-live-body">
        <div className="ss-live-eyebrow">Room {pad(index + 1)} of {pad(rooms.length)}</div>
        <div className="ss-live-room">{room.name}</div>
        <div className="ss-tally">{count}</div>
        <div className="ss-live-sub">photo{count === 1 ? "" : "s"} in this room</div>

        <div className="ss-live-cond">
          {CONDITIONS.map((c) => (
            <button key={c}
              className={`${c.toLowerCase()} ${room.condition === c ? "on" : ""}`}
              title={`Rate this room ${c} — shown in the report and sent to the AI drafting step`}
              onClick={() => onMeta({ condition: room.condition === c ? null : c })}>
              {c}
            </button>
          ))}
        </div>

        {noteOpen ? (
          <textarea
            className="ss-live-note" autoFocus rows={2}
            placeholder="Note — damage, meter reading, anything worth recording…"
            value={room.note || ""}
            onChange={(e) => onMeta({ note: e.target.value })}
            onBlur={() => { if (!(room.note || "").trim()) setNoteOpen(false); }}
          />
        ) : (
          <button className="ss-live-note-btn" onClick={() => setNoteOpen(true)}>
            <StickyNote size={13} /> {room.note ? "Edit note" : "Add note"}
          </button>
        )}

        <VoiceMemo memos={room.memos || []} onAdd={onAddMemo} onDelete={onDeleteMemo} dark />

        {last && (
          <div className="ss-last">
            <img src={last.thumb || last.dataUrl} alt="Last photo" />
            <button onClick={onDeleteLast}><Trash2 size={14} /> Delete last</button>
          </div>
        )}
      </div>

      <div className="ss-live-controls">
        <button className="ss-shutter" onClick={openCamera}>
          <Camera size={26} strokeWidth={2.4} />
          <span>Stays open — keep tapping</span>
        </button>
        <div className="ss-live-nav">
          <button disabled={index === 0} onClick={() => onIndex(index - 1)}>
            <ArrowLeft size={17} /> {index > 0 ? rooms[index - 1].name : "—"}
          </button>
          <button className="next" onClick={() => (isLast ? onExit() : onIndex(index + 1))}>
            {isLast ? "Done" : rooms[index + 1].name} {isLast ? <Check size={17} /> : <ArrowRight size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- room review ---------------- */

function RoomScreen({ room, photos, onBack, onCapture, onDelete, onMeta, onCaption, onFull, onAnnotate, onAddMemo, onDeleteMemo, onSaveToPhotos, onError }) {
  const inputRef = useRef(null);
  const [viewPhoto, setViewPhoto] = useState(null);
  const [annotating, setAnnotating] = useState(false);

  // the grid shows thumbnails; the lightbox swaps in the stored copy once read
  function openPhoto(p) {
    setViewPhoto(p);
    if (!p.dataUrl && onFull) {
      onFull(p.id).then((full) => {
        if (full && full.dataUrl) setViewPhoto((v) => (v && v.id === p.id ? { ...v, dataUrl: full.dataUrl } : v));
      });
    }
  }
  const [note, setNote] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  async function handleFile(e) {
    const files = Array.from((e.target.files) || []);
    e.target.value = "";
    for (const file of files) {
      try {
        const { dataUrl, thumb } = await processCapture(file);
        onCapture(dataUrl, file, thumb);
      } catch (err) {
        console.error(err);
        onError && onError(BAD_IMAGE_MSG);
      }
    }
  }

  async function handleSave() {
    const res = await onSaveToPhotos();
    if (res.ok) setNote("Saved to Photos");
    else if (res.reason === "unsupported") setNote("On desktop? Long-press / right-click a photo to save it");
    else if (res.reason !== "cancelled") setNote("Couldn't save — try again");
    setTimeout(() => setNote(null), 3000);
  }

  return (
    <div className="ss-col">
      <TopBar title={room.name} eyebrow={`${photos.length} photo${photos.length === 1 ? "" : "s"}`} onBack={onBack}
        right={photos.length > 0 && (
          <button className="ss-link" onClick={handleSave}><ImagePlus size={14} /> Save to Photos</button>
        )} />

      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple
        className="ss-hidden" onChange={handleFile} />

      {cameraOpen && (
        <LiveCamera
          label={room.name}
          count={photos.length}
          onCapture={onCapture}
          onClose={() => setCameraOpen(false)}
          onFallback={() => { setCameraOpen(false); inputRef.current && inputRef.current.click(); }}
        />
      )}

      {note && <div className="ss-note">{note}</div>}

      <div className="ss-scroll">
        <div className="ss-meta">
          <div className="ss-cond-row">
            <span className="ss-cond-label" title="Rated rooms show a coloured badge in the report and board, and are what the AI drafting step reads">Condition</span>
            {CONDITIONS.map((c) => (
              <button key={c}
                className={`ss-cond ${c.toLowerCase()} ${room.condition === c ? "on" : ""}`}
                title={`Rate this room ${c} — shown in the report and sent to the AI drafting step`}
                onClick={() => onMeta({ condition: room.condition === c ? null : c })}>
                {c}
              </button>
            ))}
          </div>
          <textarea
            className="ss-note-input" rows={2}
            placeholder="Notes — damage, decor, meter readings… (or use your keyboard's mic)"
            value={room.note || ""}
            onChange={(e) => onMeta({ note: e.target.value })}
          />
          <VoiceMemo memos={room.memos || []} onAdd={onAddMemo} onDelete={onDeleteMemo} />
        </div>

        {photos.length === 0 ? (
          <div className="ss-empty">
            <Camera size={22} />
            <p>No photos in {room.name} yet.<br />Open the camera below to start.</p>
          </div>
        ) : (
          <div className="ss-shots">
            {[...photos].reverse().map((p) => (
              <div key={p.id} className="ss-shot">
                <button className="ss-cell" onClick={() => openPhoto(p)}>
                  <img src={p.thumb || p.dataUrl} alt="Inspection" loading="lazy" decoding="async" />
                  {p.no ? <span className="ss-cell-no">{p.no}</span> : null}
                </button>
                <input
                  className="ss-caption"
                  placeholder="What is it? e.g. damp and mould to ceiling"
                  value={p.caption || ""}
                  onChange={(e) => onCaption(p.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-live ss-btn-big"
          onClick={() => setCameraOpen(true)}>
          <Camera size={20} strokeWidth={2.4} /> {photos.length ? "Take more photos" : "Take photos"}
        </button>
      </div>

      {viewPhoto && (
        <div className="ss-lightbox" onClick={() => setViewPhoto(null)}>
          <div className="ss-lightbox-top">
            <button onClick={() => setViewPhoto(null)}><X size={18} /></button>
          </div>
          <img src={viewPhoto.dataUrl || viewPhoto.thumb} alt="Full view" />
          <div className="ss-lightbox-bottom">
            {viewPhoto.no ? <div className="ss-lb-no">Photo {viewPhoto.no}</div> : null}
            {viewPhoto.takenAt && (
              <div className="ss-lb-time">
                {new Date(viewPhoto.takenAt).toLocaleString("en-GB", {
                  weekday: "short", day: "numeric", month: "short",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ss-btn ss-btn-ghost" disabled={!viewPhoto.dataUrl}
                onClick={(e) => { e.stopPropagation(); if (viewPhoto.dataUrl) setAnnotating(true); }}>
                <Tag size={16} /> Annotate
              </button>
              <button className="ss-btn ss-btn-danger"
                onClick={(e) => { e.stopPropagation(); onDelete(viewPhoto.id); setViewPhoto(null); }}>
                <Trash2 size={16} /> Delete photo
              </button>
            </div>
          </div>
        </div>
      )}

      {annotating && viewPhoto && (
        <PhotoAnnotator
          photo={viewPhoto}
          onClose={() => setAnnotating(false)}
          onDone={(dataUrl, thumb) => {
            onAnnotate(viewPhoto.id, dataUrl, thumb);
            setViewPhoto((v) => (v ? { ...v, dataUrl, thumb } : v));
            setAnnotating(false);
          }}
        />
      )}
    </div>
  );
}

// Draws directly onto the evidence photo — a circle or an arrow at the
// defect — then flattens it into the stored copy, the same way marking up a
// printed photo with a pen would. There's no "undo after Done"; Undo removes
// the last mark before it's baked in.
function PhotoAnnotator({ photo, onClose, onDone }) {
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const draft = useRef(null);
  const [tool, setTool] = useState("circle"); // circle|arrow
  const [strokes, setStrokes] = useState([]);
  const [, bump] = useState(0);
  const [saving, setSaving] = useState(false);

  function drawStroke(ctx, s) {
    ctx.beginPath();
    if (s.type === "circle") {
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
      const rx = Math.max(Math.abs(s.x2 - s.x1) / 2, 10), ry = Math.max(Math.abs(s.y2 - s.y1) / 2, 10);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const head = 14;
    ctx.beginPath();
    ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 6), s.y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 6), s.y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#E4573D";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const all = draft.current ? [...strokes, draft.current] : strokes;
    all.forEach((s) => drawStroke(ctx, s));
  }
  useEffect(redraw);

  function resizeCanvas() {
    const img = imgRef.current, canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    redraw();
  }
  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function onPointerDown(e) {
    e.preventDefault();
    const p = pos(e);
    draft.current = { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    canvasRef.current.setPointerCapture(e.pointerId);
    bump((n) => n + 1);
  }
  function onPointerMove(e) {
    if (!draft.current) return;
    const p = pos(e);
    draft.current = { ...draft.current, x2: p.x, y2: p.y };
    redraw();
  }
  function onPointerUp() {
    if (!draft.current) return;
    const d = draft.current;
    draft.current = null;
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 6) setStrokes((s) => [...s, d]);
    else bump((n) => n + 1);
  }
  function undo() { setStrokes((s) => s.slice(0, -1)); }

  async function done() {
    setSaving(true);
    try {
      const img = imgRef.current;
      const scaleX = img.naturalWidth / img.clientWidth;
      const scaleY = img.naturalHeight / img.clientHeight;
      const out = document.createElement("canvas");
      out.width = img.naturalWidth;
      out.height = img.naturalHeight;
      const ctx = out.getContext("2d");
      ctx.drawImage(img, 0, 0, out.width, out.height);
      ctx.strokeStyle = "#E4573D";
      ctx.lineWidth = Math.max(3, 4 * Math.min(scaleX, scaleY));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      strokes.forEach((s) => drawStroke(ctx, {
        type: s.type, x1: s.x1 * scaleX, y1: s.y1 * scaleY, x2: s.x2 * scaleX, y2: s.y2 * scaleY,
      }));
      const dataUrl = out.toDataURL("image/jpeg", 0.9);
      const thumb = drawScaled(out, out.width, out.height, THUMB_DIM, 0.72);
      onDone(dataUrl, thumb);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ss-annotate">
      <div className="ss-annotate-top">
        <button onClick={onClose} aria-label="Cancel annotating"><X size={19} /></button>
        <span>Annotate</span>
        <button onClick={undo} disabled={!strokes.length} aria-label="Undo last mark"><Undo2 size={19} /></button>
      </div>
      <div className="ss-annotate-stage">
        <img ref={imgRef} src={photo.dataUrl} alt="" onLoad={resizeCanvas} draggable={false} />
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        />
      </div>
      <div className="ss-annotate-tools">
        <button className={`ss-annotate-tool ${tool === "circle" ? "on" : ""}`} onClick={() => setTool("circle")} aria-label="Circle tool"><Circle size={18} /></button>
        <button className={`ss-annotate-tool ${tool === "arrow" ? "on" : ""}`} onClick={() => setTool("arrow")} aria-label="Arrow tool"><MoveUpRight size={18} /></button>
        <button className="ss-btn ss-btn-primary" style={{ flex: 1 }} onClick={done} disabled={saving}>
          {saving ? <Loader2 size={16} className="ss-spin" /> : <Check size={16} />} Done
        </button>
      </div>
    </div>
  );
}

function describeHttp(status) {
  if (status === 401 || status === 403) return "The upload link rejected the access key.";
  if (status === 404 || status === 410) return "The upload link no longer exists, or its scenario is switched off.";
  if (status === 413) return "A photo was too large for the upload link to accept.";
  if (status === 429) return "The upload service is rate-limiting — it may be out of monthly operations.";
  if (status >= 500) return `The upload service returned an error (${status}).`;
  return `The upload link refused the request (${status}).`;
}

// The AI drafting step (docs/cloud-workflow.md) can reply to the notes POST
// with its structured findings instead of a plain status string. Anything
// that doesn't parse as that shape is left alone — most workflows still
// just reply "Accepted" or "filed", and that's fine.
function parseDraftFindings(body) {
  if (!body) return null;
  let json;
  try { json = JSON.parse(body); } catch { return null; }
  if (!json || !Array.isArray(json.rooms)) return null;
  const ok = json.rooms.every((r) => r && typeof r.room_name === "string" && Array.isArray(r.findings));
  return ok ? json : null;
}

/* ---------------- finish / export ---------------- */

function FinishScreen({ inspection, rooms, photoCache, totalPhotos, filesForRoom, filesForUpload, fullPhoto, audioCache, onUploadResult, onExportResult, onFindings, onBack, onSaveAll, onDone, onSettings }) {
  const [note, setNote] = useState(null);
  const [direct, setDirect] = useState({ ms: null, google: false }); // account name / connected flags
  const [directUpload, setDirectUpload] = useState(null); // { provider, statuses, running, sent, total }
  const [directError, setDirectError] = useState(null);
  const [findingsOpen, setFindingsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const msId = await loadMsClientId();
      const acc = msId ? await (await loadMsGraph()).msAccount(msId) : null;
      // A silent (no-popup) request picks the Google connection back up if
      // the browser still has a live session — never worth attempting if
      // Google was never configured for this device at all.
      const googleId = await loadGoogleClientId();
      const googleOn = googleId ? await (await loadGoogleDrive()).trySilentGoogleReconnect(googleId) : false;
      setDirect({ ms: acc ? acc.username : null, google: googleOn });
    })();
  }, []);
  const [reportCache, setReportCache] = useState(null); // full-size copies, only while the report is open
  const [reportBusy, setReportBusy] = useState(false);

  async function openReport() {
    if (reportBusy) return;
    setReportBusy(true);
    try {
      const ids = rooms.flatMap((r) => r.photoIds);
      const entries = await Promise.all(ids.map(async (id) => [id, await fullPhoto(id)]));
      const cache = {};
      entries.forEach(([id, p]) => { if (p) cache[id] = p; });
      setReportCache(cache);
      setReportOpen(true);
    } finally {
      setReportBusy(false);
    }
  }
  function closeReport() {
    setReportOpen(false);
    setReportCache(null);
  }
  const [zipBusy, setZipBusy] = useState(false);
  const [hookUrl, setHookUrl] = useState("");
  const [hookKey, setHookKey] = useState("");
  const [upload, setUpload] = useState(null); // { statuses, running, doneAll, sent, total }
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const populated = rooms.filter((r) => r.photoIds.length > 0);

  useEffect(() => {
    loadWebhook().then((u) => setHookUrl(u || ""));
    loadWebhookKey().then((k) => setHookKey(k || ""));
  }, []);

  function flash(msg, ms = 3500) {
    setNote(msg);
    setTimeout(() => setNote(null), ms);
  }

  function safeName(s) {
    return s.replace(/[\\/:*?"<>|]/g, "-").trim();
  }

  async function handleSaveAll() {
    const res = await onSaveAll();
    if (res.ok) { onExportResult && onExportResult({ at: Date.now(), kind: "photos" }); flash("All photos saved to your Photos app"); }
    else if (res.reason === "unsupported") flash("Bulk save needs the phone share sheet — on desktop use the ZIP export");
    else if (res.reason !== "cancelled") flash("Couldn't save — try again");
  }

  async function exportZip() {
    if (zipBusy) return;
    setZipBusy(true);
    try {
      const zip = new JSZip();
      const rootName = safeName(`${inspection.address}${inspection.postcode ? " " + inspection.postcode : ""}`) || "Inspection";
      const root = zip.folder(rootName);
      for (const [i, room] of rooms.entries()) {
        if (!room.photoIds.length) continue;
        const folder = root.folder(`${pad(i + 1)}. ${safeName(room.name)}`);
        (await filesForRoom(room)).forEach((f) => folder.file(f.name, f));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const fileName = `${rootName}.zip`;
      const zipFile = new File([blob], fileName, { type: "application/zip" });
      if (canShareFiles() && navigator.canShare({ files: [zipFile] })) {
        try {
          await navigator.share({ files: [zipFile], title: fileName });
          onExportResult && onExportResult({ at: Date.now(), kind: "zip" });
          flash("ZIP shared — folder structure is inside");
          setZipBusy(false);
          return;
        } catch (e) {
          if (e && e.name === "AbortError") { setZipBusy(false); return; }
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onExportResult && onExportResult({ at: Date.now(), kind: "zip" });
      flash("ZIP downloaded — folder structure is inside");
    } catch (e) {
      console.error(e);
      flash("ZIP export failed — try again");
    }
    setZipBusy(false);
  }

  // One POST per item, each tagged with `kind` so the cloud workflow can route
  // it: photos are filed, voice notes are transcribed, and the single notes
  // payload is what the AI drafting step reads.
  // A 2xx only proves the workflow accepted the upload for processing — with
  // Make's default reply ("Accepted") the file may still fail to reach the
  // drive afterwards. A workflow that answers after it has filed the item
  // returns something else, and that is the only response we treat as proof.
  async function postToHook(url, key, fd) {
    const headers = key ? { "x-make-apikey": key } : undefined;
    let reason = "The upload didn't go through.";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: "POST", body: fd, headers });
        if (res.ok) {
          let body = "";
          try { body = (await res.text()).trim(); } catch { /* opaque body */ }
          const queuedOnly = body === "" || body.toLowerCase() === "accepted";
          return { ok: true, confirmed: !queuedOnly, body };
        }
        reason = describeHttp(res.status);
        // don't retry a rejection the server will just repeat
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          return { ok: false, confirmed: false, reason };
        }
      } catch (e) {
        reason = navigator.onLine === false
          ? "No internet connection."
          : "Couldn't reach the upload link — the connection dropped or the address is wrong.";
      }
    }
    return { ok: false, confirmed: false, reason };
  }

  // A workflow that transcribes audio can hand the words straight back in its
  // response instead of them living only as a stray file in OneDrive. Treat
  // anything that isn't one of the two known status replies as a transcript.
  function looksLikeTranscript(body) {
    if (!body) return false;
    const s = body.trim().toLowerCase();
    return s !== "" && s !== "accepted" && s !== "filed";
  }

  function baseFields(fd) {
    fd.append("address", inspection.address);
    fd.append("postcode", inspection.postcode || "");
    fd.append("inspectionId", inspection.id);
    return fd;
  }

  async function uploadViaWebhook() {
    try {
      await runUpload();
    } catch (e) {
      // never let an unexpected fault take the screen down mid-inspection
      console.error(e);
      setUpload((s) => s && ({ ...s, running: false }));
      setUploadError("Something went wrong during the upload. Nothing has been deleted — your photos are still on this phone.");
    }
  }

  async function runUpload() {
    const url = hookUrl.trim();
    if (!url) { flash("Set a cloud upload link in Settings first"); return; }
    if (upload && upload.running) return;
    saveWebhook(url);
    const key = hookKey.trim();
    saveWebhookKey(key);
    const statuses = {};
    populated.forEach((r) => { statuses[r.id] = "queued"; });
    const memoCount = rooms.reduce((s, r) => s + (r.memos || []).length, 0);
    const total = populated.reduce((s, r) => s + r.photoIds.length, 0) + memoCount + 1;
    setUpload({ statuses, running: true, doneAll: false, sent: 0, total });
    let anyFailed = false;
    let allConfirmed = true;
    let failReason = null;
    for (const room of populated) {
      const idx = rooms.indexOf(room);
      setUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: "uploading" } }));
      let ok = true;
      const files = await filesForUpload(room);
      for (const f of files) {
        const fd = baseFields(new FormData());
        fd.append("kind", "photo");
        fd.append("folder", `${pad(idx + 1)}. ${room.name}`);
        // the bare name matches the SOURCE column in the report workbook
        fd.append("room", room.name);
        fd.append("filename", f.name);
        fd.append("condition", room.condition || "");
        fd.append("note", room.note || "");
        fd.append("file", f, f.name);
        const r = await postToHook(url, key, fd);
        if (!r.ok) { ok = false; failReason = failReason || r.reason; break; }
        if (!r.confirmed) allConfirmed = false;
        setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      }
      if (!ok) anyFailed = true;
      setUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: ok ? "done" : "failed" } }));
    }

    // voice notes — each one goes up for transcription. If the workflow
    // hands the transcript straight back in its response, fold it into that
    // room's note now, before the notes payload below is built — otherwise
    // the AI drafting step never sees anything the surveyor only said aloud.
    const transcriptsByRoom = {};
    for (const room of rooms) {
      const idx = rooms.indexOf(room);
      for (const m of room.memos || []) {
        const blob = audioCache.current[m.id];
        if (!blob) continue;
        const name = `${safeName(room.name).replace(/\s+/g, "_")}_note_${extFor(m.type)}`;
        const fd = baseFields(new FormData());
        fd.append("kind", "audio");
        fd.append("folder", `${pad(idx + 1)}. ${room.name}`);
        fd.append("room", room.name);
        fd.append("filename", `${name}.${extFor(m.type)}`);
        fd.append("seconds", String(m.secs || 0));
        fd.append("file", blob, `${name}.${extFor(m.type)}`);
        const r = await postToHook(url, key, fd);
        if (!r.ok) { anyFailed = true; failReason = failReason || r.reason; }
        else {
          if (!r.confirmed) allConfirmed = false;
          if (looksLikeTranscript(r.body)) {
            transcriptsByRoom[room.id] = [transcriptsByRoom[room.id], r.body.trim()].filter(Boolean).join(" ");
          }
          setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
        }
      }
    }

    // one structured payload for the whole inspection — this is what the AI
    // drafting step reads, so it runs once per property rather than per photo
    const payload = {
      inspectionId: inspection.id,
      address: inspection.address,
      postcode: inspection.postcode || "",
      reference: inspection.ref || "",
      client: inspection.client || "",
      occupier: inspection.occupier || "",
      solicitor: inspection.solicitor || "",
      inspectedAt: new Date(inspection.startedAt).toISOString(),
      totalPhotos,
      rooms: rooms.map((r, i) => ({
        order: i + 1,
        folder: `${pad(i + 1)}. ${r.name}`,
        room: r.name,
        condition: r.condition || "",
        note: [r.note && r.note.trim(), transcriptsByRoom[r.id]].filter(Boolean).join(" "),
        photos: r.photoIds.length,
        voiceNotes: (r.memos || []).length,
        // photo numbers so findings can cite them without matching by hand
        photoNumbers: r.photoIds.map((id) => photoCache[id] && photoCache[id].no).filter(Boolean),
      })),
    };
    const nfd = baseFields(new FormData());
    nfd.append("kind", "notes");
    // a folder so this still files sensibly against a workflow that has no
    // routing yet and builds its path from address/folder/filename
    nfd.append("folder", "_Inspection");
    nfd.append("filename", "inspection.json");
    nfd.append("notes", JSON.stringify(payload));
    nfd.append("file", new File([JSON.stringify(payload, null, 2)], "inspection.json", { type: "application/json" }), "inspection.json");
    const nres = await postToHook(url, key, nfd);
    if (!nres.ok) { anyFailed = true; failReason = failReason || nres.reason; }
    else {
      if (!nres.confirmed) allConfirmed = false;
      setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      // if the AI drafting step is wired up on the cloud side, it can hand
      // its findings straight back in this response instead of only living
      // as a file in the drive — same trick the audio route uses for
      // transcripts. Nothing changes here if that step doesn't exist yet.
      const drafted = parseDraftFindings(nres.body);
      if (drafted && onFindings) onFindings(drafted);
    }

    setUpload((s) => s && ({ ...s, running: false, doneAll: !anyFailed }));
    setUpload((s) => s && ({ ...s, confirmed: !anyFailed && allConfirmed }));
    if (onUploadResult) onUploadResult({ at: Date.now(), ok: !anyFailed, confirmed: !anyFailed && allConfirmed, total });
    if (anyFailed) setUploadError(failReason || "The upload didn't go through.");
    else flash(allConfirmed ? "Everything filed in the cloud" : "Everything sent — your workflow will file it");
  }

  // Writes straight into the surveyor's own OneDrive or Drive with the same
  // /Inspections/<address>/<folder>/<file> layout Make produces, so a job
  // filed this way sits next to ones filed through a webhook without anyone
  // having to know which route each one took.
  async function uploadDirect(provider) {
    if (directUpload && directUpload.running) return;
    setDirectError(null);
    const statuses = {};
    populated.forEach((r) => { statuses[r.id] = "queued"; });
    const memoCount = rooms.reduce((s, r) => s + (r.memos || []).length, 0);
    const total = populated.reduce((s, r) => s + r.photoIds.length, 0) + memoCount + 1;
    setDirectUpload({ provider, statuses, running: true, sent: 0, total });

    const put = provider === "ms"
      ? async (segments, filename, file) => {
          const { uploadToOneDrive } = await loadMsGraph();
          return uploadToOneDrive(await loadMsClientId(), segments, file.name ? file : new File([file], filename, { type: file.type }));
        }
      : async (segments, filename, file) => {
          const { uploadToGoogleDrive } = await loadGoogleDrive();
          return uploadToGoogleDrive(await loadGoogleClientId(), segments, filename, file);
        };

    let failed = false, failReason = null;
    try {
      for (const room of populated) {
        const idx = rooms.indexOf(room);
        setDirectUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: "uploading" } }));
        const folder = `${pad(idx + 1)}. ${room.name}`;
        const files = await filesForUpload(room);
        for (const f of files) {
          await put(["Inspections", inspection.address, folder], f.name, f);
          setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
        }
        setDirectUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: "done" } }));
      }
      for (const room of rooms) {
        const idx = rooms.indexOf(room);
        const folder = `${pad(idx + 1)}. ${room.name}`;
        for (const m of room.memos || []) {
          const blob = audioCache.current[m.id];
          if (!blob) continue;
          const name = `${safeName(room.name).replace(/\s+/g, "_")}_note.${extFor(m.type)}`;
          await put(["Inspections", inspection.address, folder], name, blob);
          setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
        }
      }
      const payload = {
        inspectionId: inspection.id, address: inspection.address, postcode: inspection.postcode || "",
        reference: inspection.ref || "", client: inspection.client || "", occupier: inspection.occupier || "",
        solicitor: inspection.solicitor || "", inspectedAt: new Date(inspection.startedAt).toISOString(), totalPhotos,
        rooms: rooms.map((r, i) => ({
          order: i + 1, folder: `${pad(i + 1)}. ${r.name}`, room: r.name, condition: r.condition || "",
          note: (r.note || "").trim(), photos: r.photoIds.length, voiceNotes: (r.memos || []).length,
          photoNumbers: r.photoIds.map((id) => photoCache[id] && photoCache[id].no).filter(Boolean),
        })),
      };
      const notesFile = new File([JSON.stringify(payload, null, 2)], "inspection.json", { type: "application/json" });
      await put(["Inspections", inspection.address, "_Inspection"], "inspection.json", notesFile);
      setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1, running: false }));
      if (onUploadResult) onUploadResult({ at: Date.now(), ok: true, confirmed: true, total, direct: provider });
      flash(`Filed directly to ${provider === "ms" ? "OneDrive" : "Google Drive"}`);
    } catch (e) {
      failed = true;
      failReason = (e && e.message) || "The upload didn't go through.";
      setDirectUpload((s) => s && ({ ...s, running: false }));
      setDirectError(failReason);
    }
    if (failed) setUploadError(`Direct upload to ${provider === "ms" ? "OneDrive" : "Google Drive"} stopped partway: ${failReason} Nothing has been lost — your photos are still on this phone.`);
  }

  return (
    <div className="ss-col">
      <TopBar title="Finish & export" eyebrow={inspection.address} onBack={onBack} />

      <div className="ss-scroll">
        <div className="ss-summary">
          <MapPin size={15} />
          <div>
            <div className="ss-summary-title">{inspection.address}{inspection.postcode ? `, ${inspection.postcode}` : ""}</div>
            <div className="ss-summary-sub">{totalPhotos} photo{totalPhotos === 1 ? "" : "s"} · {populated.length} of {rooms.length} rooms</div>
          </div>
        </div>

        <div className="ss-section-label">Folder structure</div>
        <div className="ss-tree">
          <div className="ss-tree-root"><FolderTree size={14} /> {inspection.address}</div>
          {rooms.map((room, i) => {
            const st = (upload && upload.statuses[room.id]) || (directUpload && directUpload.statuses[room.id]) || null;
            return (
              <div key={room.id} className={`ss-tree-row ${room.photoIds.length === 0 ? "dim" : ""}`}>
                <span className={`ss-tree-dot ${st || ""}`}>
                  {st === "uploading" && <Loader2 size={11} className="ss-spin" />}
                  {st === "done" && <CircleCheck size={12} />}
                  {st === "failed" && <X size={12} />}
                  {st === "queued" && <Clock size={11} />}
                </span>
                <span className="ss-tree-name">
                  {pad(i + 1)}. {room.name}
                  {room.condition && <span className={`ss-cbadge ${room.condition.toLowerCase()}`}>{room.condition}</span>}
                  {room.note && room.note.trim() ? <StickyNote size={11} className="ss-note-flag" /> : null}
                </span>
                <span className="ss-tree-right">
                  {st === "queued" && <span className="ss-queued">queued</span>}
                  {room.photoIds.length} photo{room.photoIds.length === 1 ? "" : "s"}
                </span>
              </div>
            );
          })}
        </div>

        {inspection.lastUpload && (!upload || !upload.running) && (
          <div className={`ss-lastup ${inspection.lastUpload.ok ? "ok" : "bad"}`}>
            {inspection.lastUpload.ok ? <CircleCheck size={14} /> : <X size={14} />}
            {inspection.lastUpload.ok
              ? (inspection.lastUpload.confirmed ? "Filed in the cloud" : "Sent to the cloud")
              : "Last upload didn't finish"}
            {" · "}
            {new Date(inspection.lastUpload.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}

        <div className="ss-section-label" style={{ marginTop: 18 }}>Export</div>
        <button className="ss-btn ss-btn-primary ss-btn-big" onClick={handleSaveAll} disabled={totalPhotos === 0}
          title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
          <ImagePlus size={19} /> Save all to Photos app
        </button>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={exportZip} disabled={zipBusy || totalPhotos === 0}
          title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
          <Download size={19} />
          {zipBusy ? "Building ZIP…" : "Export ZIP (numbered folders)"}
        </button>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={openReport} disabled={totalPhotos === 0 || reportBusy}
          title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
          <FileText size={19} /> Report (print / save PDF)
        </button>
        {hookUrl ? (
          <>
            <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={uploadViaWebhook} disabled={(upload && upload.running) || totalPhotos === 0}
              title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
              <CloudUpload size={19} />
              {upload
                ? upload.running
                  ? `Uploading ${upload.sent} of ${upload.total}…`
                  : upload.doneAll
                    ? (upload.confirmed ? "Filed ✓ — send again" : "Sent ✓ — send again")
                    : "Retry upload"
                : "Upload to cloud (Make/n8n/Zapier)"}
            </button>
            {upload && upload.running && (
              <div className="ss-upbar"><div style={{ width: `${upload.total ? Math.round((upload.sent / upload.total) * 100) : 0}%` }} /></div>
            )}
          </>
        ) : null}

        {direct.ms && (
          <>
            <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }}
              onClick={() => uploadDirect("ms")} disabled={(directUpload && directUpload.running) || totalPhotos === 0}
              title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
              <CloudUpload size={19} />
              {directUpload && directUpload.provider === "ms" && directUpload.running
                ? `Filing to OneDrive ${directUpload.sent} of ${directUpload.total}…`
                : "Upload directly to OneDrive"}
            </button>
            {directUpload && directUpload.provider === "ms" && directUpload.running && (
              <div className="ss-upbar"><div style={{ width: `${directUpload.total ? Math.round((directUpload.sent / directUpload.total) * 100) : 0}%` }} /></div>
            )}
          </>
        )}
        {direct.google && (
          <>
            <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }}
              onClick={() => uploadDirect("google")} disabled={(directUpload && directUpload.running) || totalPhotos === 0}
              title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
              <CloudUpload size={19} />
              {directUpload && directUpload.provider === "google" && directUpload.running
                ? `Filing to Google Drive ${directUpload.sent} of ${directUpload.total}…`
                : "Upload directly to Google Drive"}
            </button>
            {directUpload && directUpload.provider === "google" && directUpload.running && (
              <div className="ss-upbar"><div style={{ width: `${directUpload.total ? Math.round((directUpload.sent / directUpload.total) * 100) : 0}%` }} /></div>
            )}
          </>
        )}
        {directError && <p className="ss-fineprint" style={{ color: "var(--red)" }}>{directError}</p>}

        {!hookUrl && !direct.ms && !direct.google && (
          <p className="ss-fineprint" style={{ textAlign: "center" }}>No cloud link set up yet.</p>
        )}
        <button className="ss-hook-toggle" onClick={onSettings}>
          <Link2 size={13} /> Cloud upload settings
        </button>

        {inspection.draftFindings && (
          <button className="ss-btn ss-btn-primary ss-btn-big" style={{ marginTop: 14 }} onClick={() => setFindingsOpen(true)}>
            <ShieldCheck size={19} /> Draft findings ready — review
          </button>
        )}

        {note && <div className="ss-note" style={{ marginTop: 10 }}>{note}</div>}
        <p className="ss-fineprint">
          Nothing is deleted from this device until you close the inspection
          below — export as many times as you like. The ZIP contains the exact
          numbered folder structure shown above, ready to drop into OneDrive.
        </p>
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-ghost" onClick={() => setConfirmClose(true)}>Close inspection & start fresh</button>
      </div>

      {confirmClose && (() => {
        const filed = !!(inspection.lastUpload && inspection.lastUpload.confirmed);
        const exported = !!inspection.lastExport;
        const safe = filed || exported;
        return (
          <div className="ss-modal-back" onClick={() => { setConfirmClose(false); setAcceptLoss(false); }}>
            <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ss-modal-icon"><AlertTriangle size={22} /></div>
              <div className="ss-modal-title">
                {safe ? "Close this inspection?" : "This isn't saved anywhere yet"}
              </div>
              {safe ? (
                <p>
                  All {totalPhotos} photo{totalPhotos === 1 ? "" : "s"} and notes will be removed
                  from this device. {filed
                    ? "They are confirmed filed in the cloud."
                    : "You exported them, so keep that copy safe."}
                </p>
              ) : (
                <>
                  <p>
                    {totalPhotos === 1 ? "This photo has" : `These ${totalPhotos} photos have`} not been
                    exported, and the cloud upload {inspection.lastUpload ? "was only accepted, never confirmed as filed" : "hasn't run"}.
                    Closing now deletes the only copy, and you can't reshoot a property you have left.
                  </p>
                  <label className="ss-accept">
                    <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} />
                    <span>I have the photos somewhere else, or I don't need them.</span>
                  </label>
                </>
              )}
              <button className="ss-btn ss-btn-danger" disabled={!safe && !acceptLoss} onClick={onDone}>
                <Trash2 size={16} /> Delete &amp; close
              </button>
              <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }}
                onClick={() => { setConfirmClose(false); setAcceptLoss(false); }}>
                {safe ? "Keep inspection" : "Go back and save it first"}
              </button>
            </div>
          </div>
        );
      })()}

      {uploadError && (
        <div className="ss-modal-back" onClick={() => setUploadError(null)}>
          <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ss-modal-icon"><CloudUpload size={22} /></div>
            <div className="ss-modal-title">Upload didn't finish</div>
            <p>{uploadError}</p>
            <p style={{ marginBottom: 16 }}>
              <strong>Nothing has been lost.</strong> Every photo and note is still on
              this phone. Fix the connection or the link and tap upload again, or
              export a ZIP in the meantime.
            </p>
            <button className="ss-btn ss-btn-primary" onClick={() => { setUploadError(null); uploadViaWebhook(); }}>
              Try again
            </button>
            <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }} onClick={() => setUploadError(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {reportOpen && (
        <ReportView inspection={inspection} rooms={rooms} photoCache={reportCache || photoCache} onClose={closeReport} />
      )}

      {findingsOpen && (
        <FindingsView
          draft={inspection.draftFindings}
          onClose={() => setFindingsOpen(false)}
          onChange={(next) => onFindings && onFindings(next)}
        />
      )}
    </div>
  );
}

/* ---------------- draft findings review ---------------- */

// Mirrors the schema in docs/cloud-workflow.md — the AI drafts, the surveyor
// reviews and approves each finding here before any of it reaches the
// report. Nothing here sends or files anything; "Approve" only remembers
// that a human looked at it.
function FindingsView({ draft, onClose, onChange }) {
  if (!draft || !Array.isArray(draft.rooms)) return null;

  function toggleApprove(roomIdx, findingIdx) {
    const rooms = draft.rooms.map((r, ri) => {
      if (ri !== roomIdx) return r;
      const findings = r.findings.map((f, fi) => (fi === findingIdx ? { ...f, approved: !f.approved } : f));
      return { ...r, findings };
    });
    onChange({ ...draft, rooms });
  }

  const total = draft.rooms.reduce((n, r) => n + r.findings.length, 0);
  const approved = draft.rooms.reduce((n, r) => n + r.findings.filter((f) => f.approved).length, 0);

  return (
    <div className="ss-report">
      <div className="ss-report-bar ss-noprint">
        <button className="close" onClick={onClose}><X size={16} /> Close</button>
        <span className="ss-findings-count">{approved} of {total} reviewed</span>
      </div>
      <div className="ss-report-page ss-findings-page">
        <div className="ss-findings-banner">
          <ShieldCheck size={16} />
          <span>Draft only. Nothing here is added to the report or sent anywhere — edit anything that doesn't read right in your workbook, this is just a first pass.</span>
        </div>
        {draft.rooms.map((room, ri) => (room.findings || []).map((f, fi) => (
          <div key={`${ri}-${fi}`} className="ss-finding-card">
            <div className="ss-finding-head">
              <span className="ss-finding-room">{room.room_name}</span>
              <span className={`ss-pill-conf ${f.confidence === "high" ? "ok" : "warn"}`}>
                {f.confidence === "high" ? "High confidence" : "Low confidence"}
              </span>
            </div>
            <div className="ss-finding-label">Defect</div>
            <p className="ss-finding-text">{f.defect}</p>
            <div className="ss-finding-label">Legislation</div>
            {f.legislation_breached ? (
              <span className="ss-finding-leg"><ShieldCheck size={13} /> {f.legislation_breached}</span>
            ) : (
              <span className="ss-finding-leg-empty">Not clear from the note — left blank</span>
            )}
            <div className="ss-finding-label">Remedial action</div>
            <p className="ss-finding-text">{f.remedial_action}</p>
            <button className={`ss-btn ${f.approved ? "ss-btn-primary" : "ss-btn-ghost"}`} style={{ marginTop: 10 }}
              onClick={() => toggleApprove(ri, fi)}>
              <Check size={15} /> {f.approved ? "Approved" : "Approve"}
            </button>
          </div>
        )))}
      </div>
    </div>
  );
}

/* ---------------- printable report ---------------- */

function ReportView({ inspection, rooms, photoCache, onClose }) {
  const totalPhotos = rooms.reduce((s, r) => s + r.photoIds.length, 0);
  const covered = rooms.filter((r) => r.photoIds.length > 0).length;
  const date = new Date(inspection.startedAt).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  return (
    <div className="ss-report">
      <div className="ss-report-bar ss-noprint">
        <button className="close" onClick={onClose}><X size={16} /> Close</button>
        <button className="print" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>
      </div>
      <div className="ss-report-page">
        <header className="ss-rep-head">
          <div className="ss-rep-brand"><Camera size={15} strokeWidth={2.6} /> SiteSnap</div>
          <h1>{inspection.address}{inspection.postcode ? `, ${inspection.postcode}` : ""}</h1>
          <div className="ss-rep-meta">
            <span>Photo inspection report</span>
            <span>{date}</span>
            <span>{totalPhotos} photo{totalPhotos === 1 ? "" : "s"} · {covered} of {rooms.length} areas</span>
          </div>
          {(inspection.ref || inspection.client || inspection.occupier || inspection.solicitor) && (
            <dl className="ss-rep-case">
              {inspection.ref && (<><dt>Reference</dt><dd>{inspection.ref}</dd></>)}
              {inspection.client && (<><dt>Client</dt><dd>{inspection.client}</dd></>)}
              {inspection.occupier && (<><dt>Occupier</dt><dd>{inspection.occupier}</dd></>)}
              {inspection.solicitor && (<><dt>Solicitor</dt><dd>{inspection.solicitor}</dd></>)}
            </dl>
          )}
        </header>
        {rooms.map((room, i) => {
          const photos = room.photoIds.map((id) => photoCache[id]).filter(Boolean);
          if (!photos.length && !room.condition && !(room.note && room.note.trim())) return null;
          return (
            <section key={room.id} className="ss-rep-room">
              <div className="ss-rep-room-head">
                <h2>{pad(i + 1)}. {room.name}</h2>
                {room.condition && <span className={`ss-cbadge ${room.condition.toLowerCase()}`}>{room.condition}</span>}
                <span className="ss-rep-count">{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
              </div>
              {room.note && room.note.trim() && <p className="ss-rep-note">{room.note.trim()}</p>}
              {photos.length > 0 && (
                <div className="ss-rep-grid">
                  {photos.map((p) => (
                    <figure key={p.id}>
                      <img src={p.dataUrl} alt="" />
                      {p.no ? <figcaption>Photo {p.no}</figcaption> : null}
                    </figure>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <footer className="ss-rep-foot">
          Generated with SiteSnap · {new Date().toLocaleDateString("en-GB")}
        </footer>
      </div>
    </div>
  );
}

/* ---------------- shared bits ---------------- */

function TopBar({ title, eyebrow, onBack, right }) {
  return (
    <div className="ss-topbar">
      {onBack ? (
        <button className="ss-back" onClick={onBack} aria-label="Back"><ChevronLeft size={21} /></button>
      ) : (
        <span className="ss-tick" />
      )}
      <div className="ss-topbar-text">
        <div className="ss-eyebrow-sm">{eyebrow}</div>
        <div className="ss-title">{title}</div>
      </div>
      {right || null}
    </div>
  );
}

function ReorderableList({ items, onReorder, renderRow, onRowTap }) {
  const rowRefs = useRef({});
  const [order, setOrder] = useState(items.map((i) => i.id));
  const [dragId, setDragId] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const dragInfo = useRef({ startY: 0, rowHeight: 0 });

  useEffect(() => {
    setOrder(items.map((i) => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.id).join(",")]);

  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  const down = (id) => (e) => {
    e.preventDefault();
    const row = rowRefs.current[id];
    dragInfo.current.startY = e.clientY;
    dragInfo.current.rowHeight = row ? row.getBoundingClientRect().height + 8 : 60;
    setDragId(id);
    setDragOffset(0);
  };

  useEffect(() => {
    if (!dragId) return;
    const move = (e) => {
      const dy = e.clientY - dragInfo.current.startY;
      setDragOffset(dy);
      const steps = Math.round(dy / dragInfo.current.rowHeight);
      setOrder((prev) => {
        const idx = prev.indexOf(dragId);
        let t = Math.max(0, Math.min(prev.length - 1, idx + steps));
        if (t === idx) return prev;
        const next = [...prev];
        next.splice(idx, 1);
        next.splice(t, 0, dragId);
        dragInfo.current.startY = e.clientY;
        return next;
      });
    };
    const up = () => {
      setDragId(null);
      setDragOffset(0);
      setOrder((final) => { onReorder(final.map((id) => byId[id]).filter(Boolean)); return final; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  return (
    <div className="ss-list">
      {order.map((id) => {
        const item = byId[id];
        if (!item) return null;
        const index = order.indexOf(id);
        const dragging = dragId === id;
        return (
          <div key={id}
            ref={(el) => (rowRefs.current[id] = el)}
            className={`ss-row ${dragging ? "dragging" : ""}`}
            style={{ transform: dragging ? `translateY(${dragOffset}px)` : "none" }}>
            <button className="ss-grip" onPointerDown={down(id)} aria-label="Drag to reorder">
              <GripVertical size={18} />
            </button>
            {onRowTap ? (
              <button className="ss-row-tap" onClick={() => onRowTap(item)}>{renderRow(item, index)}</button>
            ) : (
              <div className="ss-row-tap">{renderRow(item, index)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- styles ---------------- */

function StyleBlock() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Source+Serif+4:ital,wght@0,600;0,700;1,400&display=swap');

      :root {
        --paper: #F3F5F0;
        --paper-deep: #EAEEE5;
        --card: #FFFFFF;
        --ink: #16241D;
        --muted: #64716A;
        --muted2: #93A099;
        --line: #DFE5DD;
        --line-soft: #EAEEE6;
        --pine: #0E5C3F;
        --pine-press: #0A4530;
        --pine-tint: #E7F2EC;
        --hivis: #D9F44F;
        --hivis-deep: #1C2A08;
        --red: #C43C2B;
        --red-tint: #FBEAE7;
        --amber: #A66A00;
        --amber-tint: #FAF1DE;
        --topbar-bg: rgba(243,245,240,.94);
      }
      /* Field mode: a high-contrast dark theme for shooting in direct
         sunlight, where the default paper/ink pairing washes out. Every
         screen already reads off these variables, so this is the only
         place the swap happens. */
      .ss-root.ss-field {
        --paper: #0F1811;
        --paper-deep: #182419;
        --card: #17221A;
        --ink: #EFF3EC;
        --muted: #A9B7AB;
        --muted2: #6E7E70;
        --line: #283427;
        --line-soft: #202C22;
        --pine: #3FAE7C;
        --pine-press: #57C293;
        --pine-tint: #17301F;
        --red-tint: #3A1E19;
        --amber-tint: #362A10;
        --topbar-bg: rgba(15,24,17,.92);
      }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { background: var(--paper); margin: 0; }
      button { font-family: inherit; border: none; background: none; padding: 0; cursor: pointer; color: inherit; }

      .ss-root {
        min-height: 100vh; width: 100%;
        background: var(--paper); color: var(--ink);
        display: flex; justify-content: center;
        font-family: 'Archivo', system-ui, sans-serif;
        font-size: 15px; line-height: 1.4;
        transition: background .2s ease, color .2s ease;
      }
      .ss-serif { font-family: 'Source Serif 4', Georgia, serif; }
      .ss-frame { width: 100%; max-width: 430px; min-height: 100vh; display: flex; flex-direction: column; position: relative; }
      .ss-col { flex: 1; display: flex; flex-direction: column; min-height: 100vh; }
      .ss-center { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      .ss-hidden { display: none; }
      .ss-spin { animation: ss-rot 1s linear infinite; }
      @keyframes ss-rot { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .ss-spin { animation: none; } }

      /* ---- top bar ---- */
      .ss-topbar {
        position: sticky; top: 0; z-index: 20;
        background: var(--topbar-bg); backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
        padding: 12px 16px; display: flex; align-items: center; gap: 10px;
      }
      .ss-back { width: 34px; height: 34px; margin-left: -6px; display: flex; align-items: center; justify-content: center; border-radius: 10px; }
      .ss-back:active { background: var(--line-soft); }
      .ss-tick { width: 6px; height: 26px; background: var(--pine); border-radius: 3px; }
      .ss-topbar-text { flex: 1; min-width: 0; }
      .ss-eyebrow-sm { font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-title { font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-badge { font-size: 12px; font-weight: 700; background: var(--ink); color: var(--paper); padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
      .ss-link { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--pine); white-space: nowrap; }

      /* ---- layout ---- */
      .ss-scroll { flex: 1; overflow-y: auto; padding: 16px; }
      .ss-footer { padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--paper); }
      .ss-footer-split { display: flex; align-items: center; gap: 12px; }
      .ss-footer-split .ss-btn { flex: 1; }
      .ss-footer-stack { display: flex; flex-direction: column; gap: 8px; }
      .ss-count-note { font-size: 13px; color: var(--muted); font-weight: 600; white-space: nowrap; }
      .ss-section-label { font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); margin: 0 2px 8px; }
      .ss-hint { font-weight: 600; letter-spacing: 0; text-transform: none; }

      /* ---- buttons ---- */
      .ss-btn {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        font-weight: 800; font-size: 15px; border-radius: 14px;
        padding: 14px 18px; transition: transform .06s ease;
      }
      .ss-btn:active { transform: scale(.98); }
      .ss-btn:disabled { opacity: .45; pointer-events: none; }
      .ss-btn-big { width: 100%; padding: 18px; font-size: 16px; }
      .ss-btn-primary { background: var(--pine); color: #fff; }
      .ss-btn-primary:active { background: var(--pine-press); }
      .ss-btn-ghost { width: 100%; background: var(--card); border: 1px solid var(--line); color: var(--ink); }
      .ss-btn-danger { background: var(--red); color: #fff; width: 100%; }
      .ss-btn-sq { padding: 0 16px; border-radius: 12px; }

      /* ---- home ---- */
      .ss-home-hero { flex: 1; padding: 56px 26px 20px; display: flex; flex-direction: column; }
      .ss-mark { width: 44px; height: 44px; border-radius: 13px; background: var(--pine); color: var(--hivis); display: flex; align-items: center; justify-content: center; margin-bottom: 22px; }
      .ss-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--pine); margin-bottom: 10px; }
      .ss-h1 { font-family: 'Source Serif 4', Georgia, serif; font-style: italic; font-size: 38px; line-height: 1.04; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 14px; }
      .ss-lede { color: var(--muted); font-size: 15px; margin: 0 0 26px; max-width: 34ch; }
      .ss-home-steps { display: flex; flex-direction: column; gap: 10px; font-weight: 600; font-size: 14px; }
      .ss-home-steps > div { display: flex; align-items: center; gap: 10px; }
      .ss-step-n { width: 24px; height: 24px; border-radius: 8px; background: var(--card); border: 1px solid var(--line); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: var(--pine); }

      /* ---- inputs ---- */
      .ss-input {
        width: 100%; background: var(--card); border: 1px solid var(--line);
        border-radius: 12px; padding: 14px; font-size: 16px; font-family: inherit;
        color: var(--ink); outline: none;
      }
      .ss-input:focus { border-color: var(--pine); }
      .ss-inline-add { display: flex; gap: 8px; margin-top: 10px; }
      .ss-dashed {
        width: 100%; margin-top: 10px; padding: 12px;
        border: 1.5px dashed var(--muted2); border-radius: 12px;
        color: var(--muted); font-weight: 700; font-size: 13px;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }

      /* ---- room chips ---- */
      .ss-chip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .ss-chip {
        display: flex; align-items: center; justify-content: space-between;
        background: var(--card); border: 1px solid var(--line); border-radius: 12px;
        padding: 4px 8px 4px 0; min-height: 46px;
      }
      .ss-chip.on { border-color: var(--pine); background: var(--pine-tint); }
      .ss-chip-main { flex: 1; text-align: left; padding: 10px 12px; font-weight: 700; font-size: 14px; }
      .ss-chip-check { color: var(--pine); margin-right: 4px; }
      .ss-stepper { display: flex; gap: 4px; }
      .ss-stepper button {
        width: 28px; height: 28px; border-radius: 8px; background: var(--card);
        border: 1px solid var(--line); display: flex; align-items: center; justify-content: center;
        color: var(--pine);
      }

      /* ---- list / ledger rows ---- */
      .ss-list { display: flex; flex-direction: column; gap: 8px; }
      .ss-row {
        display: flex; align-items: center; gap: 4px;
        background: var(--card); border: 1px solid var(--line); border-radius: 13px;
        padding: 6px 12px 6px 4px; position: relative; z-index: 1;
      }
      .ss-row.dragging { border-color: var(--pine); box-shadow: 0 8px 24px rgba(16,36,29,.16); z-index: 10; }
      .ss-grip { width: 36px; height: 40px; display: flex; align-items: center; justify-content: center; color: var(--muted2); touch-action: none; cursor: grab; }
      .ss-row-tap { flex: 1; display: flex; align-items: center; justify-content: space-between; min-width: 0; text-align: left; padding: 6px 0; }
      .ss-row-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .ss-index { font-size: 11px; font-weight: 800; color: var(--pine); letter-spacing: .05em; width: 20px; flex-shrink: 0; }
      .ss-row-name { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-row-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 8px; }
      .ss-thumb { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; border: 1px solid var(--line); }
      .ss-thumb-empty { display: flex; align-items: center; justify-content: center; color: var(--muted2); background: var(--line-soft); }
      .ss-pill { min-width: 30px; text-align: center; font-size: 12px; font-weight: 800; padding: 4px 8px; border-radius: 999px; background: var(--line-soft); color: var(--muted); }
      .ss-pill.done { background: var(--pine); color: #fff; }

      /* ---- progress ---- */
      .ss-progress-wrap { padding: 12px 16px 0; display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; color: var(--muted); }
      .ss-progress { flex: 1; height: 6px; border-radius: 999px; background: var(--line-soft); overflow: hidden; }
      .ss-progress > div { height: 100%; background: var(--pine); border-radius: 999px; transition: width .3s ease; }

      /* ---- walkthrough (LIVE) ---- */
      .ss-live { background: var(--hivis-deep); color: var(--hivis); min-height: 100vh; }
      .ss-live-top { display: flex; align-items: center; justify-content: space-between; padding: 16px; }
      .ss-live-exit { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 14px; color: rgba(217,244,79,.75); }
      .ss-live-flag { font-size: 12px; font-weight: 900; letter-spacing: .14em; animation: ss-pulse 1.6s ease-in-out infinite; }
      @keyframes ss-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
      @media (prefers-reduced-motion: reduce) { .ss-live-flag { animation: none; } }
      .ss-live-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 24px; }
      .ss-live-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: rgba(217,244,79,.6); }
      .ss-live-room { font-size: 30px; font-weight: 900; margin-top: 6px; }
      .ss-tally { font-size: 108px; font-weight: 900; line-height: 1; margin-top: 10px; font-variant-numeric: tabular-nums; }
      .ss-live-sub { font-size: 13px; font-weight: 700; color: rgba(217,244,79,.6); margin-top: 4px; }
      .ss-last { margin-top: 18px; display: flex; align-items: center; gap: 12px; }
      .ss-last img { width: 58px; height: 58px; border-radius: 10px; object-fit: cover; border: 2px solid rgba(217,244,79,.4); }
      .ss-last button { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #FFB4A6; }
      .ss-live-controls { padding: 16px 16px calc(18px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
      .ss-shutter {
        width: 100%; background: var(--hivis); color: var(--hivis-deep);
        border-radius: 18px; padding: 20px; font-weight: 900; font-size: 17px;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        transition: transform .06s ease;
      }
      .ss-shutter span { font-size: 11px; font-weight: 700; opacity: .7; }
      .ss-shutter:active { transform: scale(.98); }
      .ss-live-nav { display: flex; gap: 8px; }
      .ss-live-nav button {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
        border: 1.5px solid rgba(217,244,79,.35); border-radius: 13px; padding: 13px;
        font-weight: 800; font-size: 14px; color: var(--hivis);
        white-space: nowrap; overflow: hidden;
      }
      .ss-live-nav button:disabled { opacity: .3; }
      .ss-live-nav .next { background: rgba(217,244,79,.14); }

      /* ---- photo grid ---- */
      .ss-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .ss-cell { aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: var(--card); border: 1px solid var(--line); }
      .ss-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .ss-empty { text-align: center; color: var(--muted); padding: 48px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px; font-size: 14px; }
      .ss-note { text-align: center; font-size: 12.5px; font-weight: 700; color: var(--pine); padding: 8px 16px 0; }

      /* ---- lightbox ---- */
      .ss-lightbox { position: fixed; inset: 0; z-index: 40; background: rgba(10,14,11,.96); display: flex; flex-direction: column; max-width: 430px; margin: 0 auto; }
      .ss-lightbox-top { display: flex; justify-content: flex-end; padding: 14px; }
      .ss-lightbox-top button { width: 36px; height: 36px; border-radius: 999px; background: rgba(255,255,255,.12); color: #fff; display: flex; align-items: center; justify-content: center; }
      .ss-lightbox img { flex: 1; min-height: 0; width: 100%; object-fit: contain; padding: 0 10px; }
      .ss-lightbox-bottom { padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); }

      /* ---- finish ---- */
      .ss-summary { display: flex; gap: 10px; align-items: flex-start; background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 14px; margin-bottom: 16px; }
      .ss-summary svg { margin-top: 2px; color: var(--pine); flex-shrink: 0; }
      .ss-summary-title { font-family: 'Source Serif 4', Georgia, serif; font-weight: 700; font-size: 16px; }
      .ss-summary-sub { font-size: 13px; color: var(--muted); font-weight: 600; margin-top: 2px; }
      .ss-tree { background: var(--card); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 4px; }
      .ss-tree-root { display: flex; align-items: center; gap: 8px; padding: 12px 14px; font-weight: 800; font-size: 14px; border-bottom: 1px solid var(--line); background: var(--paper-deep); }
      .ss-tree-root svg { color: var(--pine); }
      .ss-tree-row { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 14px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--line); }
      .ss-tree-row:last-child { border-bottom: none; }
      .ss-tree-row.dim { opacity: .4; }
      .ss-tree-name { flex: 1; min-width: 0; }
      .ss-tree-dot {
        position: relative; z-index: 1; flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
        background: var(--card); border: 1.5px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--muted2);
      }
      .ss-tree-dot.done { border-color: var(--pine); color: var(--pine); background: var(--pine-tint); }
      .ss-tree-dot.uploading { border-color: var(--amber); color: var(--amber); }
      .ss-tree-dot.failed { border-color: var(--red); color: var(--red); background: var(--red-tint); }
      .ss-tree-dot.queued { color: var(--muted2); }
      .ss-tree-row:not(:last-child) .ss-tree-dot::after {
        content: ""; position: absolute; top: 20px; left: 50%; width: 1.5px; height: 18px;
        background: var(--line); transform: translateX(-50%);
      }
      .ss-tree-right { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); font-weight: 700; flex-shrink: 0; }
      .ss-ok { color: var(--pine); }
      .ss-queued { font-size: 11px; }
      .ss-fineprint { font-size: 12.5px; color: var(--muted); line-height: 1.5; margin: 12px 2px 4px; }

      .ss-fail { color: var(--red); }
      .ss-hook-toggle { display: flex; align-items: center; gap: 6px; margin: 12px auto 0; font-size: 12.5px; font-weight: 700; color: var(--muted); padding: 6px; }
      .ss-hook { background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 12px; margin-top: 8px; }

      /* ---- toast ---- */
      .ss-toast {
        position: fixed; bottom: calc(20px + env(safe-area-inset-bottom)); left: 50%;
        transform: translateX(-50%); z-index: 50;
        background: var(--ink); color: var(--paper);
        border-radius: 999px; padding: 10px 10px 10px 18px;
        display: flex; align-items: center; gap: 14px;
        font-size: 13px; font-weight: 700;
        box-shadow: 0 10px 30px rgba(16,36,29,.3);
      }
      .ss-toast button { display: flex; align-items: center; gap: 5px; background: rgba(255,255,255,.14); color: var(--hivis); border-radius: 999px; padding: 7px 13px; font-weight: 800; font-size: 13px; }

      /* ---- condition & notes ---- */
      .ss-cdot { width: 9px; height: 9px; border-radius: 999px; flex-shrink: 0; }
      .ss-cdot.good { background: var(--pine); }
      .ss-cdot.fair { background: var(--amber); }
      .ss-cdot.poor { background: var(--red); }
      .ss-note-flag { color: var(--muted); flex-shrink: 0; }
      .ss-cbadge { font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; margin-left: 7px; vertical-align: 1px; }
      .ss-cbadge.good { background: var(--pine-tint); color: var(--pine); }
      .ss-cbadge.fair { background: var(--amber-tint); color: var(--amber); }
      .ss-cbadge.poor { background: var(--red-tint); color: var(--red); }
      .ss-tree-row .ss-note-flag { margin-left: 6px; vertical-align: -1px; }

      .ss-meta { background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 12px; margin-bottom: 14px; }
      .ss-cond-row { display: flex; align-items: center; gap: 6px; }
      .ss-cond-label { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-right: auto; }
      .ss-cond { padding: 8px 14px; border-radius: 999px; font-weight: 800; font-size: 13px; border: 1.5px solid var(--line); color: var(--muted); background: var(--paper); }
      .ss-cond.good.on { background: var(--pine-tint); border-color: var(--pine); color: var(--pine); }
      .ss-cond.fair.on { background: var(--amber-tint); border-color: var(--amber); color: var(--amber); }
      .ss-cond.poor.on { background: var(--red-tint); border-color: var(--red); color: var(--red); }
      .ss-note-input {
        width: 100%; margin-top: 10px; background: var(--paper); border: 1px solid var(--line);
        border-radius: 10px; padding: 10px 12px; font-size: 15px; font-family: inherit;
        color: var(--ink); outline: none; resize: vertical; min-height: 44px;
      }
      .ss-note-input:focus { border-color: var(--pine); }

      .ss-live-cond { display: flex; gap: 8px; margin-top: 18px; }
      .ss-live-cond button {
        padding: 9px 18px; border-radius: 999px; font-weight: 800; font-size: 13px;
        border: 1.5px solid rgba(217,244,79,.3); color: rgba(217,244,79,.65);
      }
      .ss-live-cond button.on.good { background: var(--hivis); border-color: var(--hivis); color: var(--hivis-deep); }
      .ss-live-cond button.on.fair { background: #E8B04B; border-color: #E8B04B; color: #3A2A00; }
      .ss-live-cond button.on.poor { background: #FF8A73; border-color: #FF8A73; color: #4A130A; }
      .ss-live-note-btn { display: flex; align-items: center; gap: 6px; margin-top: 14px; font-size: 13px; font-weight: 700; color: rgba(217,244,79,.65); padding: 6px 10px; }
      .ss-live-note {
        width: 100%; max-width: 320px; margin-top: 14px; background: rgba(217,244,79,.08);
        border: 1.5px solid rgba(217,244,79,.35); border-radius: 12px; padding: 10px 12px;
        font-size: 15px; font-family: inherit; color: var(--hivis); outline: none; resize: none;
      }
      .ss-live-note::placeholder { color: rgba(217,244,79,.4); }

      .ss-cell { position: relative; }
      .ss-cell-no { position: absolute; left: 4px; bottom: 4px; font-size: 10px; font-weight: 800; background: rgba(10,14,11,.66); color: #fff; border-radius: 6px; padding: 1px 5px; font-variant-numeric: tabular-nums; }
      .ss-lb-no { text-align: center; color: #fff; font-size: 13px; font-weight: 800; margin-bottom: 2px; }
      .ss-rep-case { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin: 12px 0 0; font-size: 13px; }
      .ss-rep-case dt { font-weight: 800; color: var(--muted); }
      .ss-rep-case dd { margin: 0; }
      .ss-rep-grid figure { margin: 0; }
      .ss-rep-grid figcaption { font-size: 10.5px; font-weight: 700; color: var(--muted); margin-top: 3px; }

      .ss-lastup { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; border-radius: 10px; padding: 9px 12px; margin-top: 14px; }
      .ss-lastup.ok { background: var(--pine-tint); color: var(--pine); }
      .ss-lastup.bad { background: var(--red-tint); color: var(--red); }

      .ss-job-up { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; border-radius: 999px; padding: 2px 8px; margin-top: 4px; }
      .ss-job-up.ok { background: var(--pine-tint); color: var(--pine); }
      .ss-job-up.bad { background: var(--red-tint); color: var(--red); }

      .ss-alert {
        position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 60;
        width: 100%; max-width: 430px; display: flex; align-items: flex-start; gap: 10px;
        background: var(--red); color: #fff; padding: 12px 14px calc(12px + env(safe-area-inset-top));
        padding-top: calc(12px + env(safe-area-inset-top));
        font-size: 13px; font-weight: 700; line-height: 1.4;
        box-shadow: 0 6px 20px rgba(16,36,29,.25);
      }
      .ss-alert svg { flex-shrink: 0; margin-top: 1px; }
      .ss-alert span { flex: 1; }
      .ss-alert button { color: rgba(255,255,255,.85); flex-shrink: 0; }

      .ss-tip { display: flex; gap: 9px; align-items: flex-start; background: var(--amber-tint); color: var(--amber); border-radius: 12px; padding: 11px 13px; margin-top: 14px; font-size: 12.5px; font-weight: 600; line-height: 1.45; }
      .ss-tip svg { flex-shrink: 0; margin-top: 1px; }

      .ss-filter { margin-bottom: 12px; font-size: 15px; padding: 11px 13px; }
      .ss-group-label { font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 14px 2px 7px; }
      .ss-chip-main { font-size: 13.5px; }

      .ss-accept { display: flex; gap: 9px; align-items: flex-start; text-align: left; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 11px 12px; margin-bottom: 14px; font-size: 13px; font-weight: 600; color: var(--ink); }
      .ss-accept input { width: 19px; height: 19px; flex-shrink: 0; accent-color: var(--red); margin: 0; }

      .ss-row-done { opacity: .82; }
      .ss-row-done .ss-row-tap { cursor: default; }
      .ss-job-up.warn { background: var(--amber-tint); color: var(--amber); }
      .ss-empty-note { font-size: 13.5px; color: var(--muted); text-align: center; padding: 22px 10px 4px; margin: 0; }

      .ss-shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .ss-shot { display: flex; flex-direction: column; gap: 6px; }
      .ss-shot .ss-cell { width: 100%; }
      .ss-caption {
        width: 100%; background: var(--card); border: 1px solid var(--line);
        border-radius: 9px; padding: 8px 10px; font-size: 13px; font-family: inherit;
        color: var(--ink); outline: none;
      }
      .ss-caption:focus { border-color: var(--pine); }
      .ss-caption::placeholder { font-size: 12px; }
      .ss-modal-left { text-align: left; }
      .ss-modal-left .ss-modal-title { text-align: center; }

      /* ---- in-page live camera ---- */
      .ss-livecam {
        position: fixed; inset: 0; z-index: 65; background: #000;
        display: flex; flex-direction: column;
        max-width: 430px; margin: 0 auto; overflow: hidden;
      }
      .ss-livecam-video { flex: 1; width: 100%; height: 100%; object-fit: cover; background: #000; }
      .ss-livecam-flash { position: absolute; inset: 0; background: #fff; opacity: .85; animation: ss-flashfade .13s ease-out forwards; pointer-events: none; }
      @keyframes ss-flashfade { from { opacity: .85; } to { opacity: 0; } }
      .ss-livecam-top {
        position: absolute; top: 0; left: 0; right: 0;
        padding: 14px 14px calc(14px + env(safe-area-inset-top));
        padding-top: calc(14px + env(safe-area-inset-top));
        display: flex; align-items: center; gap: 10px;
        background: linear-gradient(rgba(0,0,0,.55), transparent);
      }
      .ss-livecam-close { width: 36px; height: 36px; border-radius: 999px; background: rgba(0,0,0,.4); color: #fff; display: flex; align-items: center; justify-content: center; }
      .ss-livecam-label { flex: 1; color: #fff; font-weight: 800; font-size: 15px; text-shadow: 0 1px 3px rgba(0,0,0,.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-livecam-count { min-width: 28px; text-align: center; background: var(--hivis); color: var(--hivis-ink); font-weight: 900; font-size: 14px; border-radius: 999px; padding: 4px 10px; font-variant-numeric: tabular-nums; }
      .ss-livecam-msg {
        position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; color: #fff; text-align: center; padding: 40px 32px; font-size: 14.5px; font-weight: 600;
      }
      .ss-livecam-fallback {
        display: flex; align-items: center; gap: 8px; background: var(--hivis); color: var(--hivis-ink);
        font-weight: 800; font-size: 14px; border-radius: 999px; padding: 11px 20px; margin-top: 6px;
      }
      .ss-livecam-bottom {
        position: absolute; bottom: 0; left: 0; right: 0;
        display: flex; align-items: center; justify-content: center; gap: 0;
        padding: 20px 24px calc(28px + env(safe-area-inset-bottom));
        background: linear-gradient(transparent, rgba(0,0,0,.55));
      }
      .ss-livecam-shutter {
        width: 72px; height: 72px; border-radius: 999px; background: #fff;
        border: 4px solid rgba(255,255,255,.5); flex-shrink: 0;
        transition: transform .08s ease;
      }
      .ss-livecam-shutter:active { transform: scale(.9); }
      .ss-livecam-last {
        position: absolute; left: 24px; bottom: calc(28px + env(safe-area-inset-bottom));
        width: 44px; height: 44px; border-radius: 10px; object-fit: cover;
        border: 2px solid rgba(255,255,255,.7); box-shadow: 0 4px 12px rgba(0,0,0,.4);
      }
      .ss-livecam-switch {
        position: absolute; right: 24px; bottom: calc(38px + env(safe-area-inset-bottom));
        width: 40px; height: 40px; border-radius: 999px; background: rgba(0,0,0,.4); color: #fff;
        display: flex; align-items: center; justify-content: center;
      }

      /* ---- case details ---- */
      .ss-case-toggle { display: flex; align-items: center; gap: 6px; margin: 10px auto 0; font-size: 12.5px; font-weight: 700; color: var(--muted); padding: 6px; }
      .ss-case { display: flex; flex-direction: column; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 12px; margin-top: 6px; }

      /* ---- inspection list ---- */
      .ss-job { flex-direction: column; align-items: flex-start; gap: 2px; }
      .ss-job-sub { font-size: 12.5px; font-weight: 600; color: var(--muted); }
      .ss-job-x { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: var(--muted2); flex-shrink: 0; border-radius: 10px; }
      .ss-job-x:active { background: #F1F4EF; color: var(--red); }
      .ss-row .ss-row-tap { padding: 10px 0 10px 12px; }

      /* ---- voice memos ---- */
      .ss-vm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
      .ss-vm-btn {
        display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 800;
        border: 1.5px solid var(--line); background: var(--paper); color: var(--pine);
        border-radius: 999px; padding: 8px 14px;
      }
      .ss-vm-btn.rec { background: var(--red); border-color: var(--red); color: #fff; }
      .ss-vm-pulse { width: 9px; height: 9px; border-radius: 999px; background: #fff; animation: ss-pulse 1.2s ease-in-out infinite; }
      .ss-vm-item {
        display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;
        background: var(--pine-tint); color: var(--pine); border-radius: 999px; padding: 6px 6px 6px 11px;
      }
      .ss-vm-item button { display: inline-flex; color: var(--muted); padding: 2px; }
      .ss-vm-msg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
      .ss-vm.dark .ss-vm-btn { background: rgba(217,244,79,.1); border-color: rgba(217,244,79,.35); color: var(--hivis); }
      .ss-vm.dark .ss-vm-btn.rec { background: #FF8A73; border-color: #FF8A73; color: #4A130A; }
      .ss-vm.dark .ss-vm-pulse { background: #4A130A; }
      .ss-vm.dark .ss-vm-item { background: rgba(217,244,79,.14); color: var(--hivis); }
      .ss-vm.dark .ss-vm-item button { color: rgba(217,244,79,.7); }
      .ss-vm.dark .ss-vm-msg { color: rgba(217,244,79,.6); }
      .ss-vm.dark { justify-content: center; }

      .ss-key-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--muted); }
      .ss-key-row .ss-input { flex: 1; }

      /* ---- upload progress ---- */
      .ss-upbar { height: 6px; border-radius: 999px; background: var(--line-soft); overflow: hidden; margin-top: 10px; }
      .ss-upbar > div { height: 100%; background: var(--pine); border-radius: 999px; transition: width .25s ease; }

      /* ---- modal ---- */
      .ss-modal-back { position: fixed; inset: 0; z-index: 60; background: rgba(10,14,11,.55); display: flex; align-items: center; justify-content: center; padding: 24px; }
      .ss-modal { width: 100%; max-width: 340px; background: var(--card); border-radius: 18px; padding: 22px; text-align: center; box-shadow: 0 20px 60px rgba(16,36,29,.35); }
      .ss-modal-icon { width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 13px; background: var(--red-tint); color: var(--red); display: flex; align-items: center; justify-content: center; }
      .ss-modal-title { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
      .ss-modal p { font-size: 13.5px; color: var(--muted); line-height: 1.5; margin: 0 0 16px; }

      /* ---- lightbox timestamp ---- */
      .ss-lb-time { text-align: center; color: rgba(255,255,255,.65); font-size: 12.5px; font-weight: 600; margin-bottom: 10px; }

      /* ---- report ---- */
      .ss-report { position: fixed; inset: 0; z-index: 70; background: #fff; overflow-y: auto; }
      .ss-report-bar {
        position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between;
        padding: 12px 16px; background: rgba(255,255,255,.95); backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
      }
      .ss-report-bar button { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 13.5px; padding: 9px 14px; border-radius: 10px; }
      .ss-report-bar .close { color: var(--muted); }
      .ss-report-bar .print { background: var(--pine); color: #fff; }
      .ss-report-page { max-width: 720px; margin: 0 auto; padding: 28px 22px 48px; color: var(--ink); }
      .ss-rep-head { border-bottom: 3px solid var(--pine); padding-bottom: 18px; margin-bottom: 22px; }
      .ss-rep-brand { display: flex; align-items: center; gap: 6px; font-weight: 900; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--pine); margin-bottom: 10px; }
      .ss-rep-head h1 { font-family: 'Source Serif 4', Georgia, serif; font-size: 26px; font-weight: 700; margin: 0 0 8px; line-height: 1.15; }
      .ss-rep-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; font-weight: 600; color: var(--muted); }
      .ss-rep-room { margin-bottom: 24px; break-inside: avoid-page; }
      .ss-rep-room-head { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
      .ss-rep-room-head h2 { font-size: 16px; font-weight: 800; margin: 0; }
      .ss-rep-count { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--muted); }
      .ss-rep-note { font-size: 13.5px; color: var(--ink); background: #F5F7F3; border-left: 3px solid var(--pine); border-radius: 0 8px 8px 0; padding: 8px 12px; margin: 0 0 10px; white-space: pre-wrap; }
      .ss-rep-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .ss-rep-grid img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
      .ss-rep-foot { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); font-weight: 600; }

      @media print {
        .ss-noprint, .ss-col, .ss-toast, .ss-modal-back { display: none !important; }
        .ss-root { background: #fff; }
        .ss-report { position: static; overflow: visible; }
        .ss-report-page { max-width: none; padding: 0; }
        .ss-rep-grid img { border: none; }
      }

      /* ---- settings / home header ---- */
      .ss-home-top { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 0; }
      .ss-icon-btn {
        width: 34px; height: 34px; border-radius: 10px; background: var(--card); border: 1px solid var(--line);
        display: flex; align-items: center; justify-content: center; color: var(--muted); flex-shrink: 0;
      }
      .ss-icon-btn:active { background: var(--line-soft); }
      .ss-topbar .ss-icon-btn { margin-left: 4px; }

      .ss-search-row {
        display: flex; align-items: center; gap: 8px; margin: 12px 16px 0; padding: 10px 12px;
        background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      }
      .ss-search-ic { color: var(--muted); flex-shrink: 0; }
      .ss-search-input { flex: 1; border: none; background: none; font-size: 14.5px; font-family: inherit; color: var(--ink); outline: none; }
      .ss-search-input::placeholder { color: var(--muted2); }
      .ss-search-clear { color: var(--muted); flex-shrink: 0; display: flex; }

      .ss-cloud-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
      .ss-cloud-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
      .ss-cloud-ic { color: var(--pine); display: flex; }
      .ss-cloud-label { font-weight: 800; font-size: 14px; flex: 1; }
      .ss-cloud-connected {
        display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800;
        color: var(--pine-press); background: var(--pine-tint); padding: 3px 9px; border-radius: 999px;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .ss-settings-row { display: flex; align-items: center; gap: 12px; padding: 13px 0; }
      .ss-settings-ic {
        width: 36px; height: 36px; border-radius: 10px; background: var(--pine-tint); color: var(--pine-press);
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .ss-settings-title { font-weight: 800; font-size: 14px; }
      .ss-settings-sub { font-size: 12px; font-weight: 600; color: var(--muted); margin-top: 1px; }
      .ss-toggle {
        width: 44px; height: 26px; border-radius: 999px; background: var(--line); position: relative; flex-shrink: 0;
        transition: background .15s ease;
      }
      .ss-toggle.on { background: var(--pine); }
      .ss-toggle span {
        position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .15s ease;
      }
      .ss-toggle.on span { transform: translateX(18px); }

      .ss-storage-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }

      /* ---- draft findings ---- */
      .ss-findings-count { font-size: 12.5px; font-weight: 700; color: var(--muted); }
      .ss-findings-page { max-width: 560px; }
      .ss-findings-banner {
        display: flex; gap: 9px; align-items: flex-start; background: var(--amber-tint); color: var(--amber);
        border-radius: 12px; padding: 12px 14px; font-size: 12.5px; font-weight: 600; line-height: 1.45; margin-bottom: 16px;
      }
      .ss-findings-banner svg { flex-shrink: 0; margin-top: 1px; }
      .ss-finding-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
      .ss-finding-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .ss-finding-room { font-weight: 800; font-size: 13.5px; }
      .ss-pill-conf { font-size: 11px; font-weight: 800; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
      .ss-pill-conf.ok { background: var(--pine-tint); color: var(--pine-press); }
      .ss-pill-conf.warn { background: var(--amber-tint); color: var(--amber); }
      .ss-finding-label { font-size: 10.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--muted2); margin: 10px 0 3px; }
      .ss-finding-label:first-of-type { margin-top: 0; }
      .ss-finding-text { font-family: 'Source Serif 4', Georgia, serif; font-size: 15px; line-height: 1.5; margin: 0; }
      .ss-finding-leg { display: inline-flex; align-items: center; gap: 6px; background: var(--pine-tint); color: var(--pine-press); padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 700; }
      .ss-finding-leg-empty { font-size: 12px; font-weight: 600; color: var(--muted2); font-style: italic; }

      /* ---- on-photo annotation ---- */
      .ss-annotate {
        position: fixed; inset: 0; z-index: 68; background: #0B0F0A;
        display: flex; flex-direction: column; color: #fff;
      }
      .ss-annotate-top {
        display: flex; align-items: center; justify-content: space-between; padding: 16px 18px;
        font-size: 13px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: rgba(255,255,255,.7);
      }
      .ss-annotate-top button { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.12); display: flex; align-items: center; justify-content: center; color: #fff; }
      .ss-annotate-top button:disabled { opacity: .35; }
      .ss-annotate-stage { position: relative; flex: 1; min-height: 0; margin: 0 14px 12px; border-radius: 16px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #000; }
      .ss-annotate-stage img { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; display: block; user-select: none; }
      .ss-annotate-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
      .ss-annotate-tools { display: flex; align-items: center; gap: 10px; padding: 14px 18px calc(14px + env(safe-area-inset-bottom)); }
      .ss-annotate-tool { width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,.10); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
      .ss-annotate-tool.on { background: var(--hivis); color: var(--hivis-deep); }
    `}</style>
  );
}
