import { useEffect, useRef, useState } from "react";
import {
  Camera, Check, ChevronLeft, ChevronRight, Circle, Gauge, ImagePlus, Loader2, MoveUpRight, Plus, ScanText, Sparkles, Tag, Trash2, Undo2, X,
} from "lucide-react";
import { VoiceMemo } from "../components/VoiceMemo.jsx";
import { TopBar } from "../components/shared.jsx";
import { THUMB_DIM, drawScaled, processCapture } from "../lib/image.js";
import { CONDITIONS } from "../lib/presets.js";
import { aiConfig, aiPhotoCopy, captionRoom, AI_CAPTION_MAX } from "../ai.js";
import { withOfflineRetry } from "../aiRetry.js";
import { tapFeedback } from "../haptics.js";
import { Coach, InfoTip } from "../components/Hints.jsx";
import { BAD_IMAGE_MSG, LiveCamera } from "./Walk.jsx";
import {
  addIssue, addReading, adoptAiNote, confirmIssue, deleteIssue, deleteReading, dismissAiNote, issueFor, linkEvidence, openIssues, setActiveIssue, suggestAiNote, unassigned, unlinkEvidence, updateIssue,
} from "../evidence.js";
import { IssuePicker, IssueTag, noteSourceLabel } from "../components/Evidence.jsx";
import { OrganiseSheet } from "../components/Organise.jsx";

/* ---------------- room review ---------------- */

export function RoomScreen({ room, caseId, photos, onBack, onCapture, onDelete, onMeta, onRoom, transcripts, onTranscripts, audioCache, me, onActivity, onTrack, onCaption, onFull, onAnnotate, onAddMemo, onDeleteMemo, onSaveToPhotos, onError }) {
  const track = onTrack || (() => {});
  const inputRef = useRef(null);
  const issues = openIssues(room);
  const active = issues.find((i) => i.id === room.activeIssueId) || null;
  // the grid shows the active issue's photos (or the room's loose ones when
  // "General" is selected); "All" shows everything
  const [filter, setFilter] = useState("all"); // all | issueId | general
  const loose = unassigned(room);
  const shown = filter === "all" ? photos : filter === "general" ? photos.filter((p) => loose.photoIds.includes(p.id)) : photos.filter((p) => { const i = issueFor(room, p.id); return i && i.id === filter; });
  // newest-first — the order the grid shows, so the lightbox's next/prev
  // matches what a swipe or tap visually promises
  const ordered = [...shown].reverse();
  const [viewIndex, setViewIndex] = useState(null);
  const viewPhoto = viewIndex == null ? null : ordered[viewIndex] || null;
  const [viewFull, setViewFull] = useState(null); // {id, dataUrl} once loaded, separate from viewIndex so a slow load can't show the wrong photo
  const [annotating, setAnnotating] = useState(false);
  const [aiCfg, setAiCfg] = useState({ enabled: false });
  const [captioning, setCaptioning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [picking, setPicking] = useState(null); // { id, kind }
  const [addingIssue, setAddingIssue] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [reading, setReading] = useState(null); // { text, value, unit } while adding
  const [organising, setOrganising] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => { aiConfig().then(setAiCfg); }, []);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // the grid shows thumbnails; the lightbox swaps in the stored copy once read
  function openPhoto(idx) {
    setViewIndex(idx);
    const p = ordered[idx];
    if (p && !p.dataUrl && onFull) {
      onFull(p.id).then((full) => {
        if (full && full.dataUrl) setViewFull((v) => (p.id === (ordered[idx] || {}).id ? { id: p.id, dataUrl: full.dataUrl } : v));
      });
    }
  }
  function closePhoto() { setViewIndex(null); setViewFull(null); }
  function stepPhoto(delta) {
    setViewIndex((i) => {
      if (i == null) return i;
      const next = i + delta;
      if (next < 0 || next >= ordered.length) return i;
      const p = ordered[next];
      if (p && !p.dataUrl && onFull) {
        onFull(p.id).then((full) => {
          if (full && full.dataUrl) setViewFull((v) => (p.id === (ordered[next] || {}).id ? { id: p.id, dataUrl: full.dataUrl } : v));
        });
      } else { setViewFull(null); }
      return next;
    });
  }
  const shownPhoto = viewPhoto && viewFull && viewFull.id === viewPhoto.id ? { ...viewPhoto, dataUrl: viewFull.dataUrl } : viewPhoto;

  // keyboard left/right while the lightbox is open
  useEffect(() => {
    if (viewIndex == null) return;
    function onKey(e) {
      if (e.key === "ArrowLeft") stepPhoto(-1);
      else if (e.key === "ArrowRight") stepPhoto(1);
      else if (e.key === "Escape") closePhoto();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewIndex, ordered.length]);

  // Zoom stays local to whichever photo is open — a fresh look at the next
  // one always starts flat, same as Photos/Instagram.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef(null);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [viewIndex]);

  const MAX_ZOOM = 4;
  const ZOOM_STEP = 2.5; // what a double-tap/double-click jumps to
  function clampPan(z, p) {
    const stage = stageRef.current;
    if (!stage || z <= 1) return { x: 0, y: 0 };
    // how far the enlarged image can shift before its edge would show —
    // approximated from the stage's own box, which is close enough since
    // the photo is drawn to fill it (object-fit: contain)
    const maxX = (stage.clientWidth * (z - 1)) / 2;
    const maxY = (stage.clientHeight * (z - 1)) / 2;
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  }
  function toggleZoom() {
    setZoom((z) => { const next = z > 1 ? 1 : ZOOM_STEP; setPan((p) => clampPan(next, next > 1 ? p : { x: 0, y: 0 })); return next; });
  }

  // Pinch (two fingers) zooms; one finger pans while zoomed in, or steps
  // to the next/previous photo (a short horizontal swipe) at 1x — never
  // both at once, so a swipe-to-navigate can't fire mid-pinch.
  const touchStart = useRef(null); // swipe-nav tracking, 1x only
  const pinch = useRef(null); // { startDist, startZoom }
  const dragPan = useRef(null); // { startX, startY, startPanX, startPanY }
  const lastTap = useRef(0);
  const dist2 = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  function onStageTouchStart(e) {
    if (e.touches.length === 2) {
      pinch.current = { startDist: dist2(e.touches), startZoom: zoom };
      touchStart.current = null;
      dragPan.current = null;
    } else if (e.touches.length === 1) {
      if (zoom > 1) {
        dragPan.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startPanX: pan.x, startPanY: pan.y };
      } else {
        touchStart.current = e.touches[0].clientX;
      }
      const now = Date.now();
      if (now - lastTap.current < 300) { toggleZoom(); lastTap.current = 0; }
      else lastTap.current = now;
    }
  }
  function onStageTouchMove(e) {
    if (e.touches.length === 2 && pinch.current) {
      e.preventDefault();
      const next = Math.min(MAX_ZOOM, Math.max(1, pinch.current.startZoom * (dist2(e.touches) / pinch.current.startDist)));
      setZoom(next);
      setPan((p) => clampPan(next, p));
    } else if (e.touches.length === 1 && dragPan.current) {
      const dx = e.touches[0].clientX - dragPan.current.startX;
      const dy = e.touches[0].clientY - dragPan.current.startY;
      setPan(clampPan(zoom, { x: dragPan.current.startPanX + dx, y: dragPan.current.startPanY + dy }));
    }
  }
  function onStageTouchEnd(e) {
    if (e.touches.length > 0) return; // wait for every finger to lift
    pinch.current = null;
    dragPan.current = null;
    if (zoom <= 1 && touchStart.current != null) {
      const dx = e.changedTouches[0].clientX - touchStart.current;
      if (Math.abs(dx) > 50) stepPhoto(dx > 0 ? -1 : 1);
    }
    touchStart.current = null;
  }

  const [note, setNote] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  async function handleFile(e) {
    const files = Array.from((e.target.files) || []);
    e.target.value = "";
    for (const file of files) {
      try {
        const { dataUrl, thumb } = await processCapture(file);
        tapFeedback("light");
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

  // Fills in blank captions straight off the photos. The suggested room note
  // is held as a suggestion (room.aiNote) — never written into the note the
  // findings step reads until the surveyor adopts it.
  async function aiCaption() {
    if (captioning || !photos.length) return;
    setCaptioning(true);
    track("caption_requested", { case: caseId, room: room.id, photos: photos.length });
    try {
      const targets = photos.slice(0, AI_CAPTION_MAX);
      const payload = [];
      for (const p of targets) {
        const full = p.dataUrl ? p : (onFull ? await onFull(p.id) : null);
        if (!full || !full.dataUrl) continue;
        payload.push({ id: p.id, caption: p.caption || "", dataUrl: await aiPhotoCopy(full.dataUrl) });
      }
      if (!payload.length) { onError && onError("No photos could be loaded for captioning."); return; }
      const res = await withOfflineRetry(
        () => captionRoom({ caseId, roomId: room.id, room: { name: room.name, condition: room.condition || "", note: room.noteSource && room.noteSource !== "ai_generated" ? room.note || "" : "" }, photos: payload }),
        { isAlive: () => aliveRef.current, onQueued: (e) => aliveRef.current && setNote(e && e.code === "ai_unreachable" ? "The AI service isn't reachable right now — retrying automatically" : "No signal — captions will finish automatically once you're back online") },
      );
      let filled = 0;
      for (const c of res.photos || []) {
        const p = photos.find((x) => x.id === c.id);
        if (p && !(p.caption || "").trim() && c.caption && c.caption.trim()) { onCaption(c.id, c.caption.trim(), true); filled += 1; }
      }
      const suggested = !!(res.room_note && res.room_note.trim());
      if (suggested) onRoom((r) => suggestAiNote(r, res.room_note, res.model));
      const dropped = photos.length - targets.length;
      const bits = [];
      if (filled) bits.push(`captioned ${filled} photo${filled === 1 ? "" : "s"}`);
      if (suggested) bits.push("suggested a room note — tap Use to adopt it");
      if (dropped > 0) bits.push(`${dropped} left out (${AI_CAPTION_MAX} photo limit)`);
      setNote(bits.length ? `AI: ${bits.join(", ")}` : "AI: nothing to add — already captioned");
      setTimeout(() => setNote(null), 4500);
    } catch (e) {
      onError && onError(e && e.message ? e.message : "Couldn't caption these photos.");
    } finally {
      setCaptioning(false);
    }
  }

  // Reads a serial/model plate straight off the photo — a boiler, a meter,
  // an appliance — into that photo's caption, on-device, so it works with
  // no signal. Never overwrites a caption the surveyor already typed.
  async function scanText() {
    if (scanning || !shownPhoto || !shownPhoto.dataUrl) return;
    setScanning(true);
    try {
      const { recognizeText, likelySerials } = await import("../ocr.js");
      const text = await recognizeText(shownPhoto.dataUrl);
      const lines = likelySerials(text);
      if (!lines.length) { setNote("No text recognised on that photo"); setTimeout(() => setNote(null), 3000); return; }
      const found = lines.slice(0, 2).join(" · ");
      const existing = (shownPhoto.caption || "").trim();
      onCaption(shownPhoto.id, existing ? `${existing} — ${found}` : found);
      setNote(`Read: ${found}`);
      setTimeout(() => setNote(null), 4000);
    } catch (e) {
      console.error(e);
      setNote("Couldn't read text from this photo");
      setTimeout(() => setNote(null), 3000);
    } finally {
      setScanning(false);
    }
  }

  // ---- issues -------------------------------------------------------------
  function selectIssue(id) {
    // selecting an issue also makes it the capture target; "General" means
    // new photos and voice notes stay room-level
    setFilter(id === null ? "general" : id);
    onRoom((r) => setActiveIssue(r, id));
    tapFeedback("light");
  }
  function createIssue(title) {
    const t = (title || "").trim();
    if (!t) return;
    onRoom((r) => { const { room: r2, issue } = addIssue(r, t); setTimeout(() => setFilter(issue.id), 0); return r2; });
    onActivity && onActivity(`Issue “${t}” raised in ${room.name}`);
    setIssueTitle(""); setAddingIssue(false);
  }
  function pick(choice, newTitle) {
    const { id, kind } = picking;
    onRoom((r) => {
      if (choice === null) return unlinkEvidence(r, id);
      if (choice === "new") { const { room: r2, issue } = addIssue(r, newTitle); return linkEvidence(r2, issue.id, { id, kind, source: "human_created" }); }
      return linkEvidence(r, choice, { id, kind, source: "human_created" });
    });
    setPicking(null);
  }
  function saveReading() {
    if (!reading || !reading.text.trim()) return;
    onRoom((r) => addReading(r, reading, r.activeIssueId).room);
    setReading(null);
  }
  const activeMemos = (room.memos || []).filter((m) => filter === "all" ? true : filter === "general" ? loose.memoIds.includes(m.id) : (issueFor(room, m.id) || {}).id === filter);
  const legacyLoose = !issues.length && (loose.photoIds.length > 0 || loose.memoIds.length > 0) && room.modelVersion >= 2 && (room.photoIds || []).length > 0 && !room.activeIssueId && photos.length > 0 && photos.every((p) => loose.photoIds.includes(p.id)) && (room.issues || []).length === 0;

  const aiNoteCard = room.aiNote && !room.aiNote.adopted && !room.aiNote.dismissed && (
    <div className="ss-ainote" role="note">
      <div className="ss-ainote-head"><Sparkles size={13} /> AI suggestion — not your note until you use it</div>
      <p>{room.aiNote.text}</p>
      <div className="ss-finding-actions" style={{ marginTop: 6 }}>
        <button className="ss-btn ss-btn-primary" onClick={() => { onRoom((r) => adoptAiNote(r, me && me.user ? me.user.id : null)); onActivity && onActivity(`${room.name}: AI note adopted as the room note`); }}><Check size={14} /> Use</button>
        <button className="ss-btn ss-btn-ghost" onClick={() => { onRoom((r) => adoptAiNote(r, me && me.user ? me.user.id : null)); setTimeout(() => { const el = document.querySelector(".ss-note-input"); el && el.focus(); }, 50); }}>Edit</button>
        <button className="ss-btn ss-btn-ghost" onClick={() => onRoom(dismissAiNote)}>Dismiss</button>
      </div>
    </div>
  );

  const metaCard = (
    <div className="ss-meta">
      <div className="ss-cond-row">
        <span className="ss-cond-label" title="Rated rooms show a coloured badge in the report and board">Condition</span>
        {CONDITIONS.map((c) => (
          <button key={c}
            className={`ss-cond ${c.toLowerCase()} ${room.condition === c ? "on" : ""}`}
            title={`Rate this room ${c}`}
            onClick={() => { tapFeedback("light"); onMeta({ condition: room.condition === c ? null : c }); }}>
            {c}
          </button>
        ))}
      </div>
      <span className="ss-field-label">Room notes{room.noteSource === "human_adopted_ai" ? <span className="ss-field-label-hint"> — adopted from an AI suggestion</span> : room.noteSource === "legacy_unknown" ? <span className="ss-field-label-hint"> — origin unknown (written before 2.0)</span> : null}</span>
      <textarea
        className="ss-note-input" rows={2}
        placeholder="What's true of the room as a whole — decor, meter readings… (or use your keyboard's mic)"
        value={room.note || ""}
        onChange={(e) => onMeta({ note: e.target.value })}
      />
      {aiNoteCard}
    </div>
  );

  const issueStrip = (
    <div className="ss-issues">
      <div className="ss-issues-head">
        <span className="ss-field-label" style={{ margin: 0 }}>Issues</span>
        <InfoTip title="Issues">
          <p>One issue = one defect: <b>Ceiling mould</b>, <b>Damaged flooring</b>. Tap an issue, then shoot — every photo and voice note you take lands in it. Findings are drafted per issue.</p>
          <p>Tap the tag on any photo to move it. <b>General</b> is for evidence about the room as a whole.</p>
        </InfoTip>
      </div>
      <div className="ss-issue-chips">
        <button className={`ss-ichip ${filter === "all" ? "on" : ""}`} onClick={() => { setFilter("all"); }}>All</button>
        {issues.map((i) => (
          <button key={i.id} className={`ss-ichip ${room.activeIssueId === i.id ? "active" : ""} ${filter === i.id ? "on" : ""} ${i.confirmedBySurveyor ? "" : "suggested"}`} onClick={() => selectIssue(i.id)} title={i.confirmedBySurveyor ? `${i.title} — tap to shoot into it` : `${i.title} — AI-suggested, confirm it`}>
            {room.activeIssueId === i.id && <Camera size={11} />}{!i.confirmedBySurveyor && <Sparkles size={11} />}{i.title} <small>{(i.evidence || []).filter((e) => e.kind === "photo").length}</small>
          </button>
        ))}
        <button className={`ss-ichip ${room.activeIssueId === null && filter === "general" ? "on active" : ""}`} onClick={() => selectIssue(null)} title="Room-level evidence, not about one defect">General <small>{loose.photoIds.length}</small></button>
        {addingIssue ? (
          <span className="ss-ichip-add">
            <input className="ss-input" autoFocus placeholder="e.g. Ceiling mould" value={issueTitle} onChange={(e) => setIssueTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createIssue(issueTitle); if (e.key === "Escape") setAddingIssue(false); }} />
            <button className="ss-btn ss-btn-primary ss-btn-sq" disabled={!issueTitle.trim()} onClick={() => createIssue(issueTitle)}><Check size={16} /></button>
          </span>
        ) : (
          <button className="ss-ichip add" onClick={() => setAddingIssue(true)}><Plus size={13} /> Issue</button>
        )}
      </div>
      {active && filter === active.id && (
        <div className={`ss-issue-card ${active.confirmedBySurveyor ? "" : "suggested"}`}>
          {!active.confirmedBySurveyor && (
            <div className="ss-org-suggest">
              <Sparkles size={12} /> AI-suggested issue{active.suggestion && active.suggestion.rationale ? ` — ${active.suggestion.rationale}` : ""}. Confirm it before anything is drafted from it.
              <div className="ss-finding-actions" style={{ marginTop: 6 }}>
                <button className="ss-btn ss-btn-primary" onClick={() => onRoom((r) => confirmIssue(r, active.id))}><Check size={14} /> Confirm</button>
                <button className="ss-btn ss-btn-ghost" onClick={() => { onRoom((r) => deleteIssue(r, active.id)); setFilter("all"); }}><Trash2 size={14} /> Discard</button>
              </div>
            </div>
          )}
          {editingTitle ? (
            <input className="ss-input" autoFocus value={active.title} onChange={(e) => onRoom((r) => updateIssue(r, active.id, { title: e.target.value }))} onBlur={() => setEditingTitle(false)} onKeyDown={(e) => { if (e.key === "Enter") setEditingTitle(false); }} />
          ) : (
            <button className="ss-issue-title" onClick={() => setEditingTitle(true)} title="Rename">{active.title}</button>
          )}
          <textarea className="ss-note-input" rows={2} placeholder="What's wrong here — what you can see, any history the occupier gave"
            value={active.description || ""} onChange={(e) => onRoom((r) => updateIssue(r, active.id, { description: e.target.value, descriptionSource: "human_typed" }))} />
          <span className="ss-field-label" title="Optional. Your view of the cause. The AI works out its own view first, without seeing this, then tells you whether the evidence agrees.">
            Suspected cause <span className="ss-field-label-hint">— optional, assessed blind then compared</span>
          </span>
          <input className="ss-note-input ss-hyp-input" placeholder="e.g. condensation from a broken extractor"
            value={active.humanSuspectedCause || ""} onChange={(e) => onRoom((r) => updateIssue(r, active.id, { humanSuspectedCause: e.target.value }))} />
          <div className="ss-readings">
            {(room.readings || []).filter((rd) => (active.evidence || []).some((e) => e.id === rd.id)).map((rd) => (
              <span key={rd.id} className="ss-vm-item"><Gauge size={12} /> {rd.text}{rd.value ? ` — ${rd.value}${rd.unit ? ` ${rd.unit}` : ""}` : ""}<button onClick={() => onRoom((r) => deleteReading(r, rd.id))} aria-label="Delete reading"><X size={13} /></button></span>
            ))}
            {reading ? (
              <div className="ss-reading-add">
                <input className="ss-input" autoFocus placeholder="What was measured, e.g. moisture to wall adjacent to bath" value={reading.text} onChange={(e) => setReading({ ...reading, text: e.target.value })} />
                <div className="row">
                  <input className="ss-input" inputMode="decimal" placeholder="Value" value={reading.value} onChange={(e) => setReading({ ...reading, value: e.target.value })} />
                  <input className="ss-input" placeholder="Unit, e.g. %" value={reading.unit} onChange={(e) => setReading({ ...reading, unit: e.target.value })} />
                  <button className="ss-btn ss-btn-primary ss-btn-sq" disabled={!reading.text.trim()} onClick={saveReading}><Check size={16} /></button>
                  <button className="ss-btn ss-btn-ghost ss-btn-sq" onClick={() => setReading(null)}><X size={16} /></button>
                </div>
              </div>
            ) : (
              <button className="ss-vm-btn" onClick={() => setReading({ text: "", value: "", unit: "" })}><Gauge size={15} /> Add reading</button>
            )}
          </div>
        </div>
      )}
      {filter === "general" && (room.hypothesis || "").trim() && (
        <p className="ss-fineprint">Room-level suspected cause (from before issues): “{room.hypothesis}” — it goes with any issue you treat this room's loose evidence as.</p>
      )}
    </div>
  );

  return (
    <div className="ss-col">
      <TopBar title={room.name} eyebrow={`${photos.length} photo${photos.length === 1 ? "" : "s"}${active ? ` · shooting into ${active.title}` : ""}`} onBack={onBack}
        right={photos.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {aiCfg.enabled && (
              <>
                <button className="ss-link" disabled={captioning} onClick={aiCaption}>
                  {captioning ? <Loader2 size={14} className="ss-spin" /> : <Sparkles size={14} />} {captioning ? "Captioning…" : "AI captions"}
                </button>
                <InfoTip title="What AI captions does">
                  <p>Looks at each photo and fills in any <b>blank</b> captions with what is visible — no causes, no diagnosis — and offers a room note as a <b>suggestion</b> you can use, edit or dismiss.</p>
                  <p>It never changes a caption you've written. Captions it wrote carry a sparkle until you edit them, and the suggestion is never treated as your note unless you use it.</p>
                </InfoTip>
              </>
            )}
            <button className="ss-link ss-link-icon" onClick={handleSave} aria-label="Save this room's photos to your Photos app" title="Save this room's photos to your Photos app"><ImagePlus size={16} /></button>
          </div>
        )} />

      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple
        className="ss-hidden" onChange={handleFile} />

      {cameraOpen && (
        <LiveCamera
          label={active ? `${room.name} · ${active.title}` : room.name}
          count={photos.length}
          onCapture={onCapture}
          onClose={() => setCameraOpen(false)}
          onFallback={() => { setCameraOpen(false); inputRef.current && inputRef.current.click(); }}
        />
      )}

      {note && <div className="ss-note">{note}</div>}

      <div className="ss-scroll">
        {photos.length === 0 ? (
          // Camera-first: a surveyor walking into an empty room shoots
          // before they write anything, so the shutter prompt leads and the
          // notes/condition card — still one tap away — follows rather than
          // standing between them and the camera.
          <>
            <div className="ss-empty">
              <Camera size={22} />
              <p>No photos in {room.name} yet.<br />{active ? <>Shooting into <b>{active.title}</b>.</> : <>Raise an issue below, or just open the camera.</>}</p>
            </div>
            {issueStrip}
            {metaCard}
            <VoiceMemo memos={room.memos || []} onAdd={onAddMemo} onDelete={onDeleteMemo} renderTag={(m) => <IssueTag room={room} evidenceId={m.id} onClick={() => setPicking({ id: m.id, kind: "memo" })} />} />
          </>
        ) : (
          <>
            <Coach id="room2" title="Issues, then evidence">
              Raise an <b>issue</b> per defect and shoot into it — photos and voice notes land where they belong. Tap a photo's tag to move it. <b>AI captions</b> fills blank captions.
            </Coach>
            {legacyLoose && (
              <div className="ss-tip warn">
                <Tag size={14} />
                <span>These photos aren't organised into issues yet — findings are drafted per issue. <button className="ss-link" onClick={() => setOrganising(true)}>Organise</button></span>
              </div>
            )}
            {issueStrip}
            {metaCard}
            <VoiceMemo memos={activeMemos} onAdd={onAddMemo} onDelete={onDeleteMemo} renderTag={(m) => <IssueTag room={room} evidenceId={m.id} onClick={() => setPicking({ id: m.id, kind: "memo" })} />} />
            {shown.length === 0 && <p className="ss-empty-note">No photos {filter === "general" ? "at room level" : "in this issue"} yet — the camera shoots into it.</p>}
            <div className="ss-shots">
              {ordered.map((p, i) => (
                <div key={p.id} className="ss-shot">
                  <button className="ss-cell" onClick={() => openPhoto(i)}>
                    <img src={p.thumb || p.dataUrl} alt="Inspection" loading="lazy" decoding="async" />
                    {p.no ? <span className="ss-cell-no">{p.no}</span> : null}
                    <IssueTag room={room} evidenceId={p.id} onClick={() => setPicking({ id: p.id, kind: "photo" })} />
                  </button>
                  <div className={`ss-caption-wrap ${p.captionAi ? "ai" : ""}`}>
                    {p.captionAi && <Sparkles size={11} className="ss-caption-ai-badge" aria-label="AI-suggested — not yet reviewed" />}
                    <input
                      className="ss-caption"
                      placeholder="What is it? e.g. damp and mould to ceiling"
                      value={p.caption || ""}
                      onChange={(e) => onCaption(p.id, e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-live ss-btn-big"
          onClick={() => setCameraOpen(true)}>
          <Camera size={20} strokeWidth={2.4} /> {photos.length ? "Take more photos" : "Take photos"}{active ? <small className="ss-btn-sub"> → {active.title}</small> : null}
        </button>
      </div>

      {shownPhoto && (
        <div className="ss-lightbox" onClick={closePhoto}>
          <div className="ss-lightbox-top">
            <button onClick={closePhoto} aria-label="Close"><X size={18} /></button>
            <span className="ss-lightbox-count">{viewIndex + 1} of {ordered.length}</span>
            <span style={{ width: 40 }} />
          </div>
          <div className="ss-lightbox-stage" ref={stageRef} onClick={(e) => e.stopPropagation()}
            onTouchStart={onStageTouchStart} onTouchMove={onStageTouchMove} onTouchEnd={onStageTouchEnd}>
            <button className="ss-lightbox-arrow prev" disabled={viewIndex === 0 || zoom > 1}
              onClick={() => stepPhoto(-1)} aria-label="Previous photo"><ChevronLeft size={22} /></button>
            <img
              src={shownPhoto.dataUrl || shownPhoto.thumb} alt="Full view"
              onDoubleClick={toggleZoom}
              style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, cursor: zoom > 1 ? "grab" : "zoom-in" }}
            />
            <button className="ss-lightbox-arrow next" disabled={viewIndex === ordered.length - 1 || zoom > 1}
              onClick={() => stepPhoto(1)} aria-label="Next photo"><ChevronRight size={22} /></button>
          </div>
          {zoom > 1 && <div className="ss-lightbox-zoom-hint">{Math.round(zoom * 100)}%</div>}
          <div className="ss-lightbox-bottom" onClick={(e) => e.stopPropagation()}>
            {shownPhoto.no ? <div className="ss-lb-no">Exhibit {shownPhoto.no}{issueFor(room, shownPhoto.id) ? ` · ${issueFor(room, shownPhoto.id).title}` : ""}</div> : null}
            {shownPhoto.takenAt && (
              <div className="ss-lb-time">
                {new Date(shownPhoto.takenAt).toLocaleString("en-GB", {
                  weekday: "short", day: "numeric", month: "short",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="ss-btn ss-btn-ghost" disabled={!shownPhoto.dataUrl}
                onClick={() => { if (shownPhoto.dataUrl) setAnnotating(true); }}>
                <Tag size={16} /> Annotate
              </button>
              <button className="ss-btn ss-btn-ghost" disabled={!shownPhoto.dataUrl || scanning} onClick={scanText}
                title="Read a serial or model number straight off this photo, on-device">
                {scanning ? <Loader2 size={16} className="ss-spin" /> : <ScanText size={16} />} {scanning ? "Reading…" : "Read text"}
              </button>
              <button className="ss-btn ss-btn-ghost" onClick={() => { setPicking({ id: shownPhoto.id, kind: "photo" }); }}>
                <Tag size={16} /> Move to issue
              </button>
              <button className="ss-btn ss-btn-danger"
                onClick={() => { onDelete(shownPhoto.id); closePhoto(); }}>
                <Trash2 size={16} /> Delete photo
              </button>
            </div>
          </div>
        </div>
      )}

      {annotating && shownPhoto && (
        <PhotoAnnotator
          photo={shownPhoto}
          onClose={() => setAnnotating(false)}
          onDone={(dataUrl, thumb) => {
            onAnnotate(shownPhoto.id, dataUrl, thumb);
            setViewFull({ id: shownPhoto.id, dataUrl });
            setAnnotating(false);
          }}
        />
      )}
      {picking && <IssuePicker room={room} evidenceId={picking.id} kind={picking.kind} onClose={() => setPicking(null)} onPick={pick} />}
      {organising && <OrganiseSheet caseId={caseId} room={room} photoCache={Object.fromEntries(photos.map((p) => [p.id, p]))} fullPhoto={onFull} audioCache={audioCache} transcripts={transcripts || {}} onTranscripts={onTranscripts} onRoom={onRoom} onActivity={onActivity} onClose={() => setOrganising(false)} />}
    </div>
  );
}

// Draws directly onto the evidence photo — a circle or an arrow at the
// defect — then flattens it into the stored copy, the same way marking up a
// printed photo with a pen would. There's no "undo after Done"; Undo removes
// the last mark before it's baked in.
export function PhotoAnnotator({ photo, onClose, onDone }) {
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
