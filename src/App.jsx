import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Loader2, Undo2, X,
} from "lucide-react";
import {
  loadIndex, loadInspection, migrateLegacy, saveState, clearState, loadPhoto, savePhoto, updatePhoto, removePhoto, loadAudio, saveAudio, removeAudio, loadArchive, archiveInspection, sweepOrphans, setStorageErrorHandler, requestDurableStorage, storageEstimate, loadFieldMode, saveFieldMode, nextCaseNo,
} from "./storage.js";
import { THUMB_DIM, dataUrlToFile, drawScaled, loadImage, shareFiles } from "./lib/image.js";
import { pad, safeFileName, uid } from "./lib/util.js";
import { CaseFileScreen } from "./screens/CaseFile.jsx";
import { CasesScreen, HomeScreen } from "./screens/Home.jsx";
import { RoomScreen } from "./screens/Room.jsx";
import { SettingsScreen } from "./screens/Settings.jsx";
import { SetupScreen } from "./screens/Setup.jsx";
import { WalkScreen } from "./screens/Walk.jsx";
import { StyleBlock } from "./styles.jsx";
import { claimFromUrl } from "./cloud/service.js";

// Root: owns the open inspection, its rooms and the thumbnail cache, and
// routes between the top-level tabs and the screens inside a case file.
// Everything else lives in screens/, components/ and lib/.

export default function SiteSnap() {
  // Three top-level tabs (home|cases|settings) carry the tab bar; opening a
  // case, starting a new one, or shooting is a full-screen flow on top of
  // them (setup|casefile|walk|evidence) with no tab bar of its own — it
  // returns to whichever tab it was opened from.
  const [screen, setScreen] = useState("loading");
  const [returnTab, setReturnTab] = useState("home");
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
      // back from a same-tab cloud sign-in (see cloud/service.js)
      claimFromUrl().then((j) => { if (j) setStorageAlert(`${j.label} connected${j.account ? " — " + j.account : ""}`); });
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
  // opening one only pulls that property's media into memory. `fromTab` is
  // remembered so the case file's back button returns to wherever it was
  // opened from (Home's active case, or the full Cases ledger).
  async function openInspection(id, fromTab = "home") {
    const data = await loadInspection(id);
    if (!data || !data.inspection) { await refreshIndex(); return; }
    suppressSaveId.current = null;
    setReturnTab(fromTab);
    setCaseTab("overview");
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
    setScreen("casefile");
  }

  // Leaves the property loaded on disk — the surveyor is moving to the next
  // job, not finishing this one. Lands on whichever tab the case was opened
  // from by default, or `target` when a screen inside the case file (the
  // Export tab's cloud-settings link) sends the surveyor somewhere specific —
  // either way this is the ONLY path back to the top-level tabs, so it's the
  // one place `index` gets refreshed with what just changed.
  async function exitCase(target) {
    await flushAll();
    setInspection(null);
    setRooms([]);
    setPhotoCache({});
    originals.current = {};
    audioCache.current = {};
    photoSeq.current = 0;
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
    const caseNo = await nextCaseNo();
    const insp = {
      id: uid("insp"), address, postcode, startedAt: Date.now(), caseNo,
      activity: [{ ts: Date.now(), text: "Case opened" }],
      ...(caseDetails || {}),
    };
    const rms = roomList.map((r) => ({ id: r.id, name: r.name, photoIds: [] }));
    suppressSaveId.current = null;
    setReturnTab("home");
    setCaseTab("overview");
    setInspection(insp);
    setRooms(rms);
    setPhotoCache({});
    originals.current = {};
    photoSeq.current = 0;
    setScreen("casefile");
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
    const roomName = (rooms.find((r) => r.id === roomId) || {}).name || "a room";
    logActivity(`Photo added to ${roomName} — Exhibit ${no}`);
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
    const roomName = (rooms.find((r) => r.id === roomId) || {}).name || "a room";
    logActivity(`Voice note added to ${roomName}`);
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
    // only condition changes are worth a log line — logging every keystroke
    // of a note would flood it
    if ("condition" in patch) {
      const roomName = (rooms.find((r) => r.id === roomId) || {}).name || "a room";
      logActivity(patch.condition ? `${roomName} rated ${patch.condition}` : `${roomName} rating cleared`);
    }
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
    memoIds.forEach((id) => removeAudio(id));
    await exitCase();
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
            onNew={() => { setReturnTab("home"); setScreen("setup"); }}
            onOpen={(id) => openInspection(id, "home")}
            onTab={setScreen}
          />
        )}

        {screen === "cases" && (
          <CasesScreen
            index={index}
            archive={archive}
            durable={durable}
            onNew={() => { setReturnTab("cases"); setScreen("setup"); }}
            onOpen={(id) => openInspection(id, "cases")}
            onDiscard={discardInspection}
            onTab={setScreen}
          />
        )}

        {screen === "settings" && (
          <SettingsScreen
            fieldMode={fieldMode}
            onToggleFieldMode={toggleFieldMode}
            onTab={setScreen}
          />
        )}

        {screen === "setup" && (
          <SetupScreen onBack={() => setScreen(returnTab)} onStart={startInspection} />
        )}

        {screen === "casefile" && inspection && (
          <CaseFileScreen
            inspection={inspection}
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
            onUploadResult={(r) => { setInspectionMeta({ lastUpload: r }); logActivity(r.ok ? (r.confirmed ? "Filed in the cloud" : "Sent to the cloud") : "Upload didn't finish"); }}
            onExportResult={(r) => setInspectionMeta({ lastExport: r })}
            onFindings={(f) => setInspectionMeta({ draftFindings: f })}
            onSaveAll={async () => shareFiles(await filesForAll(), "Inspection photos")}
            onDone={finishAndReset}
            onSettings={() => exitCase("settings")}
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
            onExit={() => setScreen("casefile")}
          />
        )}

        {screen === "evidence" && (() => {
          const room = rooms.find((r) => r.id === activeRoomId);
          if (!room) { setScreen("casefile"); return null; }
          return (
            <RoomScreen
              room={room}
              photos={room.photoIds.map((id) => photoCache[id]).filter(Boolean)}
              onBack={() => setScreen("casefile")}
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
