import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Trash2, GripVertical, ChevronLeft, Plus, Minus, MapPin,
  CloudUpload, Check, X, Loader2, ImagePlus, ArrowRight, ArrowLeft,
  Undo2, FolderTree, CircleCheck, Image as ImageIcon, Download, Link2,
  StickyNote, FileText, Printer, AlertTriangle, Mic, MicOff, KeyRound,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  SiteSnap — room-by-room property inspection photos                 */
/*  Mockup v2: walkthrough capture, one-screen setup, ledger overview  */
/* ------------------------------------------------------------------ */

const PRESETS = [
  { base: "External", steppable: false },
  { base: "Hallway", steppable: false },
  { base: "Living Room", steppable: false },
  { base: "Dining Room", steppable: false },
  { base: "Kitchen", steppable: false },
  { base: "Utility Room", steppable: false },
  { base: "Bedroom", steppable: true },
  { base: "Ensuite", steppable: true },
  { base: "Bathroom", steppable: true },
  { base: "WC", steppable: false },
  { base: "Landing", steppable: false },
  { base: "Stairs", steppable: false },
  { base: "Conservatory", steppable: false },
  { base: "Garden", steppable: false },
  { base: "Garage", steppable: false },
  { base: "Loft", steppable: false },
  { base: "Attic", steppable: false },
  { base: "External Walls & Drains", steppable: false },
  { base: "Infestation", steppable: false },
  { base: "Meters", steppable: false },
  { base: "Smoke / CO Alarms", steppable: false },
  { base: "Additional Claim Item", steppable: true },
];

const CONDITIONS = ["Good", "Fair", "Poor"];

function uid(p) {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}

/* ---------- image helpers ---------- */

function compressImage(file, maxDim = 2200, quality = 0.87) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
  loadPhoto, savePhoto, removePhoto,
  loadAudio, saveAudio, removeAudio,
  loadWebhook, saveWebhook,
  loadWebhookKey, saveWebhookKey,
} from "./storage.js";

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      setState("denied");
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
  const [screen, setScreen] = useState("loading"); // loading|home|setup|board|walk|room|finish
  const [inspection, setInspection] = useState(null);
  const [index, setIndex] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [photoCache, setPhotoCache] = useState({});
  const [walkIndex, setWalkIndex] = useState(0);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [undoItem, setUndoItem] = useState(null); // {photo, roomId}
  const undoTimer = useRef(null);
  const originals = useRef({}); // id -> File/Blob (full quality, this session only)
  const audioCache = useRef({}); // memo id -> Blob

  useEffect(() => {
    (async () => {
      await migrateLegacy();
      setIndex(await loadIndex());
      setScreen("home");
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
    setInspection(data.inspection);
    setRooms(data.rooms || []);
    const ids = (data.rooms || []).flatMap((r) => r.photoIds);
    const entries = await Promise.all(ids.map(async (pid) => [pid, await loadPhoto(pid)]));
    const cache = {};
    entries.forEach(([pid, p]) => { if (p) cache[pid] = p; });
    setPhotoCache(cache);
    audioCache.current = {};
    const memoIds = (data.rooms || []).flatMap((r) => (r.memos || []).map((m) => m.id));
    await Promise.all(memoIds.map(async (mid) => {
      const b = await loadAudio(mid);
      if (b) audioCache.current[mid] = b;
    }));
    originals.current = {};
    setScreen("board");
  }

  // Leaves the property loaded on disk — the surveyor is moving to the next
  // job, not finishing this one.
  async function backToHome() {
    setInspection(null);
    setRooms([]);
    setPhotoCache({});
    originals.current = {};
    audioCache.current = {};
    await refreshIndex();
    setScreen("home");
  }

  const persist = useCallback((insp, rms) => { saveState(insp, rms); }, []);

  function startInspection(address, postcode, roomList) {
    const insp = { id: uid("insp"), address, postcode, startedAt: Date.now() };
    const rms = roomList.map((r) => ({ id: r.id, name: r.name, photoIds: [] }));
    setInspection(insp);
    setRooms(rms);
    setPhotoCache({});
    originals.current = {};
    setScreen("board");
    persist(insp, rms);
    setTimeout(refreshIndex, 0);
  }

  async function addPhoto(roomId, dataUrl, originalFile) {
    const photo = { id: uid("ph"), roomId, dataUrl, takenAt: Date.now() };
    if (originalFile) originals.current[photo.id] = originalFile;
    setPhotoCache((c) => ({ ...c, [photo.id]: photo }));
    setRooms((prev) => {
      const next = prev.map((r) =>
        r.id === roomId ? { ...r, photoIds: [...r.photoIds, photo.id] } : r
      );
      persist(inspection, next);
      return next;
    });
    savePhoto(photo);
  }

  function deletePhoto(roomId, photoId) {
    const photo = photoCache[photoId];
    setRooms((prev) => {
      const next = prev.map((r) =>
        r.id === roomId ? { ...r, photoIds: r.photoIds.filter((id) => id !== photoId) } : r
      );
      persist(inspection, next);
      return next;
    });
    removePhoto(photoId);
    // keep it around for undo
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoItem({ photo, roomId });
    undoTimer.current = setTimeout(() => setUndoItem(null), 5000);
  }

  function undoDelete() {
    if (!undoItem) return;
    const { photo, roomId } = undoItem;
    setPhotoCache((c) => ({ ...c, [photo.id]: photo }));
    setRooms((prev) => {
      const next = prev.map((r) =>
        r.id === roomId ? { ...r, photoIds: [...r.photoIds, photo.id] } : r
      );
      persist(inspection, next);
      return next;
    });
    savePhoto(photo);
    setUndoItem(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  function reorderRooms(next) {
    setRooms(next);
    persist(inspection, next);
  }

  async function addMemo(roomId, blob, secs) {
    const id = uid("aud");
    await saveAudio(id, blob);
    audioCache.current[id] = blob;
    setRooms((prev) => {
      const next = prev.map((r) =>
        r.id === roomId ? { ...r, memos: [...(r.memos || []), { id, secs, type: blob.type }] } : r
      );
      persist(inspection, next);
      return next;
    });
  }

  function deleteMemo(roomId, memoId) {
    setRooms((prev) => {
      const next = prev.map((r) =>
        r.id === roomId ? { ...r, memos: (r.memos || []).filter((m) => m.id !== memoId) } : r
      );
      persist(inspection, next);
      return next;
    });
    removeAudio(memoId);
    delete audioCache.current[memoId];
  }

  function setRoomMeta(roomId, patch) {
    setRooms((prev) => {
      const next = prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r));
      persist(inspection, next);
      return next;
    });
  }

  function addRoom(name) {
    setRooms((prev) => {
      const next = [...prev, { id: uid("room"), name, photoIds: [] }];
      persist(inspection, next);
      return next;
    });
  }

  async function finishAndReset() {
    const ids = rooms.flatMap((r) => r.photoIds);
    const memoIds = rooms.flatMap((r) => (r.memos || []).map((m) => m.id));
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

  // compressedOnly: webhook/Graph uploads have 4-5MB request limits, so the
  // cloud path always sends the compressed copy; exports keep full quality.
  function filesFor(photoIds, label, compressedOnly = false) {
    return photoIds
      .map((id, i) => {
        const orig = compressedOnly ? null : originals.current[id];
        if (orig) {
          const ext = (orig.type && orig.type.split("/")[1]) || "jpg";
          return new File([orig], `${label}_${i + 1}.${ext}`, { type: orig.type || "image/jpeg" });
        }
        const p = photoCache[id];
        if (p) return dataUrlToFile(p.dataUrl, `${label}_${i + 1}.jpg`);
        return null;
      })
      .filter(Boolean);
  }

  const totalPhotos = rooms.reduce((s, r) => s + r.photoIds.length, 0);
  const doneRooms = rooms.filter((r) => r.photoIds.length > 0).length;

  return (
    <div className="ss-root">
      <StyleBlock />
      <div className="ss-frame">
        {screen === "loading" && (
          <div className="ss-center"><Loader2 className="ss-spin" size={26} /></div>
        )}

        {screen === "home" && (
          <HomeScreen
            index={index}
            onNew={() => setScreen("setup")}
            onOpen={openInspection}
            onDiscard={discardInspection}
          />
        )}

        {screen === "setup" && (
          <SetupScreen onBack={() => setScreen("home")} onStart={startInspection} />
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
            onCapture={(dataUrl, file) => addPhoto(rooms[walkIndex].id, dataUrl, file)}
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
              onCapture={(dataUrl, file) => addPhoto(room.id, dataUrl, file)}
              onDelete={(pid) => deletePhoto(room.id, pid)}
              onMeta={(patch) => setRoomMeta(room.id, patch)}
              onAddMemo={(blob, secs) => addMemo(room.id, blob, secs)}
              onDeleteMemo={(mid) => deleteMemo(room.id, mid)}
              onSaveToPhotos={() => shareFiles(filesFor(room.photoIds, room.name.replace(/\s+/g, "_")), `${room.name} photos`)}
            />
          );
        })()}

        {screen === "finish" && inspection && (
          <FinishScreen
            inspection={inspection}
            rooms={rooms}
            photoCache={photoCache}
            totalPhotos={totalPhotos}
            filesForRoom={(room) => filesFor(room.photoIds, room.name.replace(/\s+/g, "_"))}
            filesForUpload={(room) => filesFor(room.photoIds, room.name.replace(/\s+/g, "_"), true)}
            audioCache={audioCache}
            onBack={() => setScreen("board")}
            onSaveAll={() => shareFiles(filesFor(rooms.flatMap((r) => r.photoIds), "inspection"), "Inspection photos")}
            onDone={finishAndReset}
          />
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

function HomeScreen({ index, onNew, onOpen, onDiscard }) {
  const [confirmId, setConfirmId] = useState(null);
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const target = open.find((i) => i.id === confirmId);

  if (open.length === 0) {
    return (
      <div className="ss-col">
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
      </div>

      <div className="ss-scroll">
        <div className="ss-list">
          {open.map((i) => (
            <div key={i.id} className="ss-row">
              <button className="ss-row-tap" onClick={() => onOpen(i.id)}>
                <div className="ss-row-main ss-job">
                  <span className="ss-row-name">{i.address}</span>
                  <span className="ss-job-sub">
                    {i.postcode ? i.postcode + " · " : ""}
                    {i.photos} photo{i.photos === 1 ? "" : "s"} · {i.rooms} area{i.rooms === 1 ? "" : "s"}
                    {" · "}{relativeDay(i.startedAt)}
                  </span>
                </div>
              </button>
              <button className="ss-job-x" onClick={() => setConfirmId(i.id)} aria-label={`Discard ${i.address}`}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <p className="ss-fineprint">
          Inspections stay on this device until you export and close them, so you
          can run several properties in a day and upload when you have signal.
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

/* ---------------- setup (one screen) ---------------- */

function SetupScreen({ onBack, onStart }) {
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [items, setItems] = useState([]); // {id, base, custom?}
  const [customName, setCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

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

        <div className="ss-section-label" style={{ marginTop: 20 }}>Rooms &amp; areas</div>
        <div className="ss-chip-grid">
          {PRESETS.map((p) => {
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
          onClick={() => onStart(address.trim(), postcode.trim(), named)}>
          Start inspection <ArrowRight size={17} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- board (overview) ---------------- */

function BoardScreen({ inspection, rooms, photoCache, totalPhotos, doneRooms, onReorder, onAddRoom, onHome, onOpenRoom, onWalk, onFinish }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const firstEmpty = Math.max(0, rooms.findIndex((r) => r.photoIds.length === 0));
  const pct = rooms.length ? Math.round((doneRooms / rooms.length) * 100) : 0;

  return (
    <div className="ss-col">
      <TopBar
        title={inspection.address}
        eyebrow={inspection.postcode || "Inspection in progress"}
        onBack={onHome}
        right={<span className="ss-badge">{totalPhotos} photo{totalPhotos === 1 ? "" : "s"}</span>}
      />

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
                    <img src={thumb.dataUrl} alt="" className="ss-thumb" />
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

function WalkScreen({ rooms, index, photoCache, onIndex, onCapture, onDeleteLast, onMeta, onAddMemo, onDeleteMemo, onExit }) {
  const inputRef = useRef(null);
  const continuous = useRef(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const room = rooms[index];
  const count = room.photoIds.length;
  const lastId = room.photoIds[count - 1];
  const last = lastId ? photoCache[lastId] : null;
  const isLast = index === rooms.length - 1;

  useEffect(() => { setNoteOpen(false); }, [index]);

  function openCamera() {
    continuous.current = true;
    inputRef.current && inputRef.current.click();
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) { continuous.current = false; return; }
    compressImage(file).then((dataUrl) => onCapture(dataUrl, file));
    // reopen straight away — keep shooting until the user cancels the camera
    if (continuous.current) inputRef.current && inputRef.current.click();
  }

  return (
    <div className="ss-col ss-live">
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        className="ss-hidden" onChange={handleFile} />

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
            <img src={last.dataUrl} alt="Last photo" />
            <button onClick={onDeleteLast}><Trash2 size={14} /> Delete last</button>
          </div>
        )}
      </div>

      <div className="ss-live-controls">
        <button className="ss-shutter" onClick={openCamera}>
          <Camera size={26} strokeWidth={2.4} />
          <span>Open camera — shoot until you cancel</span>
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

function RoomScreen({ room, photos, onBack, onCapture, onDelete, onMeta, onAddMemo, onDeleteMemo, onSaveToPhotos }) {
  const inputRef = useRef(null);
  const continuous = useRef(false);
  const [viewPhoto, setViewPhoto] = useState(null);
  const [note, setNote] = useState(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) { continuous.current = false; return; }
    compressImage(file).then((d) => onCapture(d, file));
    if (continuous.current) inputRef.current && inputRef.current.click();
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

      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        className="ss-hidden" onChange={handleFile} />

      {note && <div className="ss-note">{note}</div>}

      <div className="ss-scroll">
        <div className="ss-meta">
          <div className="ss-cond-row">
            <span className="ss-cond-label">Condition</span>
            {CONDITIONS.map((c) => (
              <button key={c}
                className={`ss-cond ${c.toLowerCase()} ${room.condition === c ? "on" : ""}`}
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
          <div className="ss-grid">
            {[...photos].reverse().map((p) => (
              <button key={p.id} className="ss-cell" onClick={() => setViewPhoto(p)}>
                <img src={p.dataUrl} alt="Inspection" />
              </button>
            ))}
          </div>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-live ss-btn-big"
          onClick={() => { continuous.current = true; inputRef.current && inputRef.current.click(); }}>
          <Camera size={20} strokeWidth={2.4} /> {photos.length ? "Take more photos" : "Take photos"}
        </button>
      </div>

      {viewPhoto && (
        <div className="ss-lightbox" onClick={() => setViewPhoto(null)}>
          <div className="ss-lightbox-top">
            <button onClick={() => setViewPhoto(null)}><X size={18} /></button>
          </div>
          <img src={viewPhoto.dataUrl} alt="Full view" />
          <div className="ss-lightbox-bottom">
            {viewPhoto.takenAt && (
              <div className="ss-lb-time">
                {new Date(viewPhoto.takenAt).toLocaleString("en-GB", {
                  weekday: "short", day: "numeric", month: "short",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
            <button className="ss-btn ss-btn-danger"
              onClick={(e) => { e.stopPropagation(); onDelete(viewPhoto.id); setViewPhoto(null); }}>
              <Trash2 size={16} /> Delete photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- finish / export ---------------- */

function FinishScreen({ inspection, rooms, photoCache, totalPhotos, filesForRoom, filesForUpload, audioCache, onBack, onSaveAll, onDone }) {
  const [note, setNote] = useState(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [hookUrl, setHookUrl] = useState("");
  const [hookKey, setHookKey] = useState("");
  const [hookOpen, setHookOpen] = useState(false);
  const [upload, setUpload] = useState(null); // { statuses, running, doneAll, sent, total }
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
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
    if (res.ok) flash("All photos saved to your Photos app");
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
      rooms.forEach((room, i) => {
        if (!room.photoIds.length) return;
        const folder = root.folder(`${pad(i + 1)}. ${safeName(room.name)}`);
        filesForRoom(room).forEach((f) => folder.file(f.name, f));
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const fileName = `${rootName}.zip`;
      const zipFile = new File([blob], fileName, { type: "application/zip" });
      if (canShareFiles() && navigator.canShare({ files: [zipFile] })) {
        try {
          await navigator.share({ files: [zipFile], title: fileName });
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
  async function postToHook(url, key, fd) {
    const headers = key ? { "x-make-apikey": key } : undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: "POST", body: fd, headers });
        if (res.ok) return true;
        // don't retry a rejection the server will just repeat
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return false;
      } catch { /* network error — loop retries once */ }
    }
    return false;
  }

  function baseFields(fd) {
    fd.append("address", inspection.address);
    fd.append("postcode", inspection.postcode || "");
    fd.append("inspectionId", inspection.id);
    return fd;
  }

  async function uploadViaWebhook() {
    const url = hookUrl.trim();
    if (!url) { setHookOpen(true); return; }
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
    for (const room of populated) {
      const idx = rooms.indexOf(room);
      setUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: "uploading" } }));
      let ok = true;
      const files = filesForUpload(room);
      for (const f of files) {
        const fd = baseFields(new FormData());
        fd.append("kind", "photo");
        fd.append("folder", `${pad(idx + 1)}. ${room.name}`);
        fd.append("filename", f.name);
        fd.append("condition", room.condition || "");
        fd.append("note", room.note || "");
        fd.append("file", f, f.name);
        if (!(await postToHook(url, key, fd))) { ok = false; break; }
        setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      }
      if (!ok) anyFailed = true;
      setUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: ok ? "done" : "failed" } }));
    }

    // voice notes — each one goes up for transcription
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
        if (!(await postToHook(url, key, fd))) anyFailed = true;
        else setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      }
    }

    // one structured payload for the whole inspection — this is what the AI
    // drafting step reads, so it runs once per property rather than per photo
    const payload = {
      inspectionId: inspection.id,
      address: inspection.address,
      postcode: inspection.postcode || "",
      inspectedAt: new Date(inspection.startedAt).toISOString(),
      totalPhotos,
      rooms: rooms.map((r, i) => ({
        order: i + 1,
        folder: `${pad(i + 1)}. ${r.name}`,
        room: r.name,
        condition: r.condition || "",
        note: (r.note || "").trim(),
        photos: r.photoIds.length,
        voiceNotes: (r.memos || []).length,
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
    if (!(await postToHook(url, key, nfd))) anyFailed = true;
    else setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));

    setUpload((s) => s && ({ ...s, running: false, doneAll: !anyFailed }));
    flash(anyFailed ? "Something didn't send — check the link and tap upload to retry" : "Photos, voice notes and site notes all sent");
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
            const st = upload ? upload.statuses[room.id] : null;
            return (
              <div key={room.id} className={`ss-tree-row ${room.photoIds.length === 0 ? "dim" : ""}`}>
                <span>
                  {pad(i + 1)}. {room.name}
                  {room.condition && <span className={`ss-cbadge ${room.condition.toLowerCase()}`}>{room.condition}</span>}
                  {room.note && room.note.trim() ? <StickyNote size={11} className="ss-note-flag" /> : null}
                </span>
                <span className="ss-tree-right">
                  {st === "uploading" && <Loader2 size={13} className="ss-spin" />}
                  {st === "done" && <CircleCheck size={14} className="ss-ok" />}
                  {st === "failed" && <X size={14} className="ss-fail" />}
                  {st === "queued" && <span className="ss-queued">queued</span>}
                  {room.photoIds.length} photo{room.photoIds.length === 1 ? "" : "s"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="ss-section-label" style={{ marginTop: 18 }}>Export</div>
        <button className="ss-btn ss-btn-primary ss-btn-big" onClick={handleSaveAll}>
          <ImagePlus size={19} /> Save all to Photos app
        </button>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={exportZip} disabled={zipBusy || totalPhotos === 0}>
          <Download size={19} />
          {zipBusy ? "Building ZIP…" : "Export ZIP (numbered folders)"}
        </button>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={() => setReportOpen(true)} disabled={totalPhotos === 0}>
          <FileText size={19} /> Report (print / save PDF)
        </button>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={uploadViaWebhook} disabled={(upload && upload.running) || totalPhotos === 0}>
          <CloudUpload size={19} />
          {upload ? (upload.running ? `Uploading ${upload.sent} of ${upload.total}…` : upload.doneAll ? "Uploaded ✓ — upload again" : "Retry failed uploads") : "Upload to cloud"}
        </button>
        {upload && upload.running && (
          <div className="ss-upbar"><div style={{ width: `${upload.total ? Math.round((upload.sent / upload.total) * 100) : 0}%` }} /></div>
        )}

        <button className="ss-hook-toggle" onClick={() => setHookOpen((o) => !o)}>
          <Link2 size={13} /> {hookUrl ? "Cloud upload link set — change" : "Set cloud upload link"}
        </button>
        {hookOpen && (
          <div className="ss-hook">
            <input
              className="ss-input"
              placeholder="https://your-n8n.app/webhook/inspections"
              value={hookUrl}
              onChange={(e) => setHookUrl(e.target.value)}
              inputMode="url"
              autoCapitalize="none"
            />
            <div className="ss-key-row">
              <KeyRound size={14} />
              <input
                className="ss-input" placeholder="Access key (optional)"
                value={hookKey} onChange={(e) => setHookKey(e.target.value)}
                autoCapitalize="none" autoComplete="off"
              />
            </div>
            <p className="ss-fineprint" style={{ marginTop: 8 }}>
              Paste a webhook URL (Make, n8n or Zapier). Photos, voice notes and a
              single site-notes file are POSTed with the address and folder name,
              and your workflow files them into OneDrive or Google Drive — no
              Microsoft or Google sign-in needed in this app. Set an access key
              here and in your webhook so only your phone can upload.
            </p>
            <button className="ss-btn ss-btn-primary" style={{ width: "100%" }}
              onClick={() => { saveWebhook(hookUrl.trim()); saveWebhookKey(hookKey.trim()); setHookOpen(false); flash("Upload link saved"); }}>
              Save link
            </button>
          </div>
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

      {confirmClose && (
        <div className="ss-modal-back" onClick={() => setConfirmClose(false)}>
          <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ss-modal-icon"><AlertTriangle size={22} /></div>
            <div className="ss-modal-title">Close this inspection?</div>
            <p>
              All {totalPhotos} photo{totalPhotos === 1 ? "" : "s"} and notes will be removed
              from this device. Anything already exported or uploaded is unaffected.
            </p>
            <button className="ss-btn ss-btn-danger" onClick={onDone}>
              <Trash2 size={16} /> Delete &amp; close
            </button>
            <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }} onClick={() => setConfirmClose(false)}>
              Keep inspection
            </button>
          </div>
        </div>
      )}

      {reportOpen && (
        <ReportView inspection={inspection} rooms={rooms} photoCache={photoCache} onClose={() => setReportOpen(false)} />
      )}
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
                  {photos.map((p) => <img key={p.id} src={p.dataUrl} alt="" />)}
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
      @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');

      :root {
        --paper: #F3F5F0;
        --card: #FFFFFF;
        --ink: #16241D;
        --muted: #64716A;
        --line: #DFE5DD;
        --pine: #0E5C3F;
        --pine-press: #0A4530;
        --hivis: #D9F44F;
        --hivis-deep: #1C2A08;
        --red: #C43C2B;
        --amber: #A66A00;
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
      }
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
        background: rgba(243,245,240,.94); backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
        padding: 12px 16px; display: flex; align-items: center; gap: 10px;
      }
      .ss-back { width: 34px; height: 34px; margin-left: -6px; display: flex; align-items: center; justify-content: center; border-radius: 10px; }
      .ss-back:active { background: #E7EBE4; }
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
      .ss-h1 { font-size: 38px; line-height: 1.04; font-weight: 900; letter-spacing: -0.01em; margin: 0 0 14px; }
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
        border: 1.5px dashed #C4CDC2; border-radius: 12px;
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
      .ss-chip.on { border-color: var(--pine); background: #EAF3EC; }
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
      .ss-grip { width: 36px; height: 40px; display: flex; align-items: center; justify-content: center; color: #A9B3A9; touch-action: none; cursor: grab; }
      .ss-row-tap { flex: 1; display: flex; align-items: center; justify-content: space-between; min-width: 0; text-align: left; padding: 6px 0; }
      .ss-row-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .ss-index { font-size: 11px; font-weight: 800; color: var(--pine); letter-spacing: .05em; width: 20px; flex-shrink: 0; }
      .ss-row-name { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-row-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 8px; }
      .ss-thumb { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; border: 1px solid var(--line); }
      .ss-thumb-empty { display: flex; align-items: center; justify-content: center; color: #B9C2B8; background: #F0F3EE; }
      .ss-pill { min-width: 30px; text-align: center; font-size: 12px; font-weight: 800; padding: 4px 8px; border-radius: 999px; background: #EEF1EC; color: var(--muted); }
      .ss-pill.done { background: var(--pine); color: #fff; }

      /* ---- progress ---- */
      .ss-progress-wrap { padding: 12px 16px 0; display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; color: var(--muted); }
      .ss-progress { flex: 1; height: 6px; border-radius: 999px; background: #E2E7E0; overflow: hidden; }
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
      .ss-summary-title { font-weight: 800; font-size: 15px; }
      .ss-summary-sub { font-size: 13px; color: var(--muted); font-weight: 600; margin-top: 2px; }
      .ss-tree { background: var(--card); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 4px; }
      .ss-tree-root { display: flex; align-items: center; gap: 8px; padding: 12px 14px; font-weight: 800; font-size: 14px; border-bottom: 1px solid var(--line); background: #F7F9F5; }
      .ss-tree-root svg { color: var(--pine); }
      .ss-tree-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 10px 30px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--line); }
      .ss-tree-row:last-child { border-bottom: none; }
      .ss-tree-row.dim { opacity: .4; }
      .ss-tree-right { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); font-weight: 700; }
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
      .ss-cbadge.good { background: #EAF3EC; color: var(--pine); }
      .ss-cbadge.fair { background: #F6EFDD; color: var(--amber); }
      .ss-cbadge.poor { background: #F8E7E3; color: var(--red); }
      .ss-tree-row .ss-note-flag { margin-left: 6px; vertical-align: -1px; }

      .ss-meta { background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 12px; margin-bottom: 14px; }
      .ss-cond-row { display: flex; align-items: center; gap: 6px; }
      .ss-cond-label { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-right: auto; }
      .ss-cond { padding: 8px 14px; border-radius: 999px; font-weight: 800; font-size: 13px; border: 1.5px solid var(--line); color: var(--muted); background: var(--paper); }
      .ss-cond.good.on { background: #EAF3EC; border-color: var(--pine); color: var(--pine); }
      .ss-cond.fair.on { background: #F6EFDD; border-color: var(--amber); color: var(--amber); }
      .ss-cond.poor.on { background: #F8E7E3; border-color: var(--red); color: var(--red); }
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

      /* ---- inspection list ---- */
      .ss-job { flex-direction: column; align-items: flex-start; gap: 2px; }
      .ss-job-sub { font-size: 12.5px; font-weight: 600; color: var(--muted); }
      .ss-job-x { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: #B9C2B8; flex-shrink: 0; border-radius: 10px; }
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
        background: var(--pine-soft, #EAF3EC); color: var(--pine); border-radius: 999px; padding: 6px 6px 6px 11px;
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
      .ss-upbar { height: 6px; border-radius: 999px; background: #E2E7E0; overflow: hidden; margin-top: 10px; }
      .ss-upbar > div { height: 100%; background: var(--pine); border-radius: 999px; transition: width .25s ease; }

      /* ---- modal ---- */
      .ss-modal-back { position: fixed; inset: 0; z-index: 60; background: rgba(10,14,11,.55); display: flex; align-items: center; justify-content: center; padding: 24px; }
      .ss-modal { width: 100%; max-width: 340px; background: var(--card); border-radius: 18px; padding: 22px; text-align: center; box-shadow: 0 20px 60px rgba(16,36,29,.35); }
      .ss-modal-icon { width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 13px; background: #F8E7E3; color: var(--red); display: flex; align-items: center; justify-content: center; }
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
      .ss-rep-head h1 { font-size: 26px; font-weight: 900; margin: 0 0 8px; line-height: 1.15; }
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
    `}</style>
  );
}
