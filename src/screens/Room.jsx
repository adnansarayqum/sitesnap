import { useEffect, useRef, useState } from "react";
import {
  Camera, Check, ChevronLeft, ChevronRight, Circle, ImagePlus, Loader2, MoveUpRight, Sparkles, Tag, Trash2, Undo2, X,
} from "lucide-react";
import { VoiceMemo } from "../components/VoiceMemo.jsx";
import { TopBar } from "../components/shared.jsx";
import { THUMB_DIM, drawScaled, processCapture } from "../lib/image.js";
import { CONDITIONS } from "../lib/presets.js";
import { aiConfig, aiPhotoCopy, captionRoom, AI_MAX_PHOTOS } from "../ai.js";
import { BAD_IMAGE_MSG, LiveCamera } from "./Walk.jsx";

/* ---------------- room review ---------------- */

export function RoomScreen({ room, caseId, photos, onBack, onCapture, onDelete, onMeta, onCaption, onFull, onAnnotate, onAddMemo, onDeleteMemo, onSaveToPhotos, onError }) {
  const inputRef = useRef(null);
  // newest-first — the order the grid shows, so the lightbox's next/prev
  // matches what a swipe or tap visually promises
  const ordered = [...photos].reverse();
  const [viewIndex, setViewIndex] = useState(null);
  const viewPhoto = viewIndex == null ? null : ordered[viewIndex] || null;
  const [viewFull, setViewFull] = useState(null); // {id, dataUrl} once loaded, separate from viewIndex so a slow load can't show the wrong photo
  const [annotating, setAnnotating] = useState(false);
  const [aiCfg, setAiCfg] = useState({ enabled: false });
  const [captioning, setCaptioning] = useState(false);
  useEffect(() => { aiConfig().then(setAiCfg); }, []);

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

  // a light swipe left/right steps photos; a small deliberate horizontal
  // drag, not an accidental brush while scrolling the (non-scrolling) stage
  const touchStart = useRef(null);
  function onStageTouchStart(e) { touchStart.current = e.touches[0].clientX; }
  function onStageTouchEnd(e) {
    if (touchStart.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(dx) > 50) stepPhoto(dx > 0 ? -1 : 1);
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

  // Fills in what's blank — captions the model can read straight off the
  // photos, and a starting-point room note from the set as a whole. Never
  // overwrites a caption or note the surveyor already typed; everything it
  // does add stays in the normal editable fields, same as if typed by hand.
  async function aiCaption() {
    if (captioning || !photos.length) return;
    setCaptioning(true);
    try {
      const targets = photos.slice(0, AI_MAX_PHOTOS);
      const payload = [];
      for (const p of targets) {
        const full = p.dataUrl ? p : (onFull ? await onFull(p.id) : null);
        if (!full || !full.dataUrl) continue;
        payload.push({ id: p.id, caption: p.caption || "", dataUrl: await aiPhotoCopy(full.dataUrl) });
      }
      if (!payload.length) { onError && onError("No photos could be loaded for captioning."); return; }
      const res = await captionRoom({
        caseId, roomId: room.id,
        room: { name: room.name, condition: room.condition || "", note: room.note || "" },
        photos: payload,
      });
      let filled = 0;
      for (const c of res.photos || []) {
        const p = photos.find((x) => x.id === c.id);
        if (p && !(p.caption || "").trim() && c.caption && c.caption.trim()) { onCaption(c.id, c.caption.trim()); filled += 1; }
      }
      const notedRoom = !!(res.room_note && !(room.note || "").trim());
      if (notedRoom) onMeta({ note: res.room_note });
      const dropped = photos.length - targets.length;
      const bits = [];
      if (filled) bits.push(`captioned ${filled} photo${filled === 1 ? "" : "s"}`);
      if (notedRoom) bits.push("added a room note");
      if (dropped > 0) bits.push(`${dropped} left out (${AI_MAX_PHOTOS} photo limit)`);
      setNote(bits.length ? `AI: ${bits.join(", ")} — check and edit before moving on` : "AI: nothing to add — already captioned");
      setTimeout(() => setNote(null), 4000);
    } catch (e) {
      onError && onError(e && e.message ? e.message : "Couldn't caption these photos.");
    } finally {
      setCaptioning(false);
    }
  }

  return (
    <div className="ss-col">
      <TopBar title={room.name} eyebrow={`${photos.length} photo${photos.length === 1 ? "" : "s"}`} onBack={onBack}
        right={photos.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {aiCfg.enabled && (
              <button className="ss-link" disabled={captioning} onClick={aiCaption}>
                {captioning ? <Loader2 size={14} className="ss-spin" /> : <Sparkles size={14} />} {captioning ? "Captioning…" : "AI captions"}
              </button>
            )}
            <button className="ss-link" onClick={handleSave}><ImagePlus size={14} /> Save to Photos</button>
          </div>
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
          <input
            className="ss-note-input ss-hyp-input"
            placeholder="Your read on the cause, if you have one — the AI tests it against the photos"
            title="Optional. Say what you think is causing it; the draft will say whether the photographs agree, and flag it if they don't."
            value={room.hypothesis || ""}
            onChange={(e) => onMeta({ hypothesis: e.target.value })}
          />
          <VoiceMemo memos={room.memos || []} onAdd={onAddMemo} onDelete={onDeleteMemo} />
        </div>

        {photos.length === 0 ? (
          <>
            <div className="ss-empty">
              <Camera size={22} />
              <p>No photos in {room.name} yet.<br />Open the camera below to start.</p>
            </div>
            <div className="ss-tip info">
              <Sparkles size={14} />
              <span>{aiCfg.enabled
                ? "Once you've shot a few, AI captions can fill these in for you — still yours to edit."
                : "Exhibit numbers start fresh in each room, so photo 1 here won't clash with photo 1 elsewhere."}</span>
            </div>
          </>
        ) : (
          <div className="ss-shots">
            {ordered.map((p, i) => (
              <div key={p.id} className="ss-shot">
                <button className="ss-cell" onClick={() => openPhoto(i)}>
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

      {shownPhoto && (
        <div className="ss-lightbox" onClick={closePhoto}>
          <div className="ss-lightbox-top">
            <button onClick={closePhoto} aria-label="Close"><X size={18} /></button>
            <span className="ss-lightbox-count">{viewIndex + 1} of {ordered.length}</span>
            <span style={{ width: 40 }} />
          </div>
          <div className="ss-lightbox-stage" onClick={(e) => e.stopPropagation()}
            onTouchStart={onStageTouchStart} onTouchEnd={onStageTouchEnd}>
            <button className="ss-lightbox-arrow prev" disabled={viewIndex === 0}
              onClick={() => stepPhoto(-1)} aria-label="Previous photo"><ChevronLeft size={22} /></button>
            <img src={shownPhoto.dataUrl || shownPhoto.thumb} alt="Full view" />
            <button className="ss-lightbox-arrow next" disabled={viewIndex === ordered.length - 1}
              onClick={() => stepPhoto(1)} aria-label="Next photo"><ChevronRight size={22} /></button>
          </div>
          <div className="ss-lightbox-bottom" onClick={(e) => e.stopPropagation()}>
            {shownPhoto.no ? <div className="ss-lb-no">Exhibit {shownPhoto.no}</div> : null}
            {shownPhoto.takenAt && (
              <div className="ss-lb-time">
                {new Date(shownPhoto.takenAt).toLocaleString("en-GB", {
                  weekday: "short", day: "numeric", month: "short",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ss-btn ss-btn-ghost" disabled={!shownPhoto.dataUrl}
                onClick={() => { if (shownPhoto.dataUrl) setAnnotating(true); }}>
                <Tag size={16} /> Annotate
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
