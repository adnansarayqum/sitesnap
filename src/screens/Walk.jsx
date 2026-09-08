import { useEffect, useRef, useState } from "react";
import {
  Aperture, ArrowLeft, ArrowRight, Camera, Check, Expand, Loader2, Moon, RefreshCw, StickyNote, Sun, SwitchCamera, Trash2, X,
} from "lucide-react";
import { VoiceMemo } from "../components/VoiceMemo.jsx";
import { PHOTO_DIM, THUMB_DIM, drawScaled, processCapture } from "../lib/image.js";
import { CONDITIONS } from "../lib/presets.js";
import { pad } from "../lib/util.js";
import { tapFeedback } from "../haptics.js";

/* ---------------- walkthrough capture ---------------- */

/* ---------------- in-page live camera ---------------- */
// A native camera app hand-off is safe but slow: each shot leaves the page,
// and the round trip is what made shooting feel like "snap, click Use Photo,
// wait for the camera to reopen". This runs the camera feed inline instead —
// tap the shutter, the frame is grabbed straight off the video element, the
// feed never stops. Falls back to the native picker (via onFallback) if the
// browser or device won't cooperate, so shooting never dead-ends.
export function LiveCamera({ label, count, lastThumb, resumeKey, onCapture, onClose, onFallback, onWideShot, condition, onCondition, fieldMode, onToggleFieldMode }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [state, setState] = useState("starting"); // starting|ready|denied|busy|unsupported
  const [flash, setFlash] = useState(false);
  const [justTaken, setJustTaken] = useState(null); // small data URL of the last frame
  // Some Android cameras expose a continuous optical range through this same
  // getUserMedia track — including below 1x on phones whose "environment"
  // camera is a fused wide/ultra-wide/tele module. Where that's not exposed
  // (iOS Safari, older Android, single-lens phones) the controls just don't
  // appear, same as before.
  const [zoomCaps, setZoomCaps] = useState(null); // {min, max, step} or null
  const [zoom, setZoom] = useState(1);
  // Phones that keep the ultra-wide lens as a separate physical camera
  // (rather than folding it into one continuous zoom range) need switching
  // by device instead — this lets a wide shot still be reachable even when
  // zoomCaps above doesn't go below 1x.
  const [lenses, setLenses] = useState([]); // MediaDeviceInfo[], back-facing candidates
  const [activeLensId, setActiveLensId] = useState(null);
  const capturing = useRef(false);
  const alive = useRef(true);
  const opening = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const zoomStateRef = useRef({ zoom: 1, caps: null });
  zoomStateRef.current = { zoom, caps: zoomCaps };
  const activeLensIdRef = useRef(null);
  activeLensIdRef.current = activeLensId;

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function detectZoom(stream) {
    try {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : null;
      if (caps && caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max > caps.zoom.min) {
        const settings = track.getSettings ? track.getSettings() : {};
        const z = typeof settings.zoom === "number" ? settings.zoom : caps.zoom.min;
        setZoomCaps({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
        setZoom(z);
      } else {
        setZoomCaps(null);
        setZoom(1);
      }
    } catch {
      setZoomCaps(null);
      setZoom(1);
    }
  }

  function applyZoom(z) {
    const caps = zoomStateRef.current.caps;
    if (!caps) return;
    const clamped = Math.min(caps.max, Math.max(caps.min, z));
    setZoom(clamped);
    const track = streamRef.current && streamRef.current.getVideoTracks()[0];
    if (track) track.applyConstraints({ advanced: [{ zoom: clamped }] }).catch(() => {});
  }

  // Device labels only populate once camera permission is granted, so this
  // can only run after a stream is already live. "front" is the one word
  // reliably present across manufacturers' labelling; anything else (the
  // main, ultra-wide, and tele back lenses) is left in the list for the
  // surveyor to cycle through and see which one is actually wide.
  async function refreshLenses(stream) {
    try {
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings ? track.getSettings() : {};
      const devices = await navigator.mediaDevices.enumerateDevices();
      let cams = devices.filter((d) => d.kind === "videoinput" && !/front/i.test(d.label));
      // iOS (16.3+) lists each back lens on its own — "Back Camera", "Back
      // Ultra Wide Camera", "Back Telephoto Camera" — plus fused "Dual Wide"
      // / "Triple" virtual cameras that duplicate them and, on iOS 18, swap
      // lens by themselves mid-shot. Keep the physical set when there is one.
      const physical = cams.filter((d) => !/dual|triple/i.test(d.label));
      if (physical.length) cams = physical;
      if (!alive.current) return;
      setLenses(cams);
      setActiveLensId(settings.deviceId || (cams[0] && cams[0].deviceId) || null);
    } catch {
      if (alive.current) setLenses([]);
    }
  }

  const activeLabel = (lenses.find((d) => d.deviceId === activeLensId) || {}).label || "";
  // the slider reads in the lens's own units; shown relative to the main
  // camera so 0.5× on an iPhone's ultra-wide means what it means in the
  // phone's camera app
  const lensScale = /ultra/i.test(activeLabel) ? 0.5 : 1;

  function pickLens(device) {
    if (!device || device.deviceId === activeLensId) return;
    stopStream();
    startStream(device.deviceId);
  }

  function switchLens() {
    if (lenses.length < 2) return;
    const idx = lenses.findIndex((d) => d.deviceId === activeLensId);
    pickLens(lenses[(idx + 1) % lenses.length]);
  }

  // Where the browser can't reach the ultra-wide lens at all (Samsung keeps
  // it away from third-party apps, Chrome included), the phone's own camera
  // app still can. This borrows it for one shot: release the sensor first
  // so the camera app can open it, and the visibility/focus handlers below
  // bring the live feed straight back once the surveyor returns.
  function wideShot() {
    stopStream();
    setState("starting");
    onWideShot();
  }

  // Native (non-passive) touch listeners, so preventDefault actually stops
  // the gesture — React's synthetic touch handlers are passive by default
  // and can't reliably block it. Reads current zoom/caps off a ref so this
  // effect only needs to run once, not on every zoom change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pinch = null;
    const dist = (touches) => {
      const [a, b] = touches;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    function onStart(e) {
      if (e.touches.length === 2) pinch = { startDist: dist(e.touches), startZoom: zoomStateRef.current.zoom };
    }
    function onMove(e) {
      if (e.touches.length === 2 && pinch && zoomStateRef.current.caps) {
        e.preventDefault();
        const ratio = dist(e.touches) / pinch.startDist;
        applyZoom(pinch.startZoom * ratio);
      }
    }
    function onEnd(e) {
      if (e.touches.length < 2) pinch = null;
    }
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startStream(deviceId) {
    if (opening.current) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setState("unsupported");
      return;
    }
    opening.current = true;
    setState("starting");
    const defaultConstraints = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: PHOTO_DIM }, height: { ideal: PHOTO_DIM } }, audio: false },
      { video: true, audio: false }, // older devices reject exact/ideal facingMode
    ];
    // a lens picked earlier that's since gone missing (unplugged USB cam,
    // odd driver hiccup) falls through to the same default chain rather
    // than leaving the surveyor stuck on "camera unsupported"
    const constraints = deviceId
      ? [{ video: { deviceId: { exact: deviceId }, width: { ideal: PHOTO_DIM }, height: { ideal: PHOTO_DIM } }, audio: false }, ...defaultConstraints]
      : defaultConstraints;
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
          detectZoom(stream);
          refreshLenses(stream);
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
    // `resume` also runs on focus/pageshow: coming back from the phone's
    // camera app (wideShot above) doesn't always fire visibilitychange —
    // some pickers overlay the page rather than backgrounding it.
    function resume() {
      if (!document.hidden && !streamRef.current && stateRef.current === "starting") startStream(activeLensIdRef.current);
    }
    function onVis() {
      if (document.hidden) {
        stopStream();
        if (stateRef.current === "ready") setState("starting");
      } else {
        resume();
      }
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // belt and braces for the wide-shot round trip: the parent bumps this
  // when the camera app hands a photo back, in case no focus/visibility
  // event marked the return
  useEffect(() => {
    if (resumeKey && !streamRef.current && stateRef.current === "starting") startStream(activeLensIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeKey]);

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
    tapFeedback("light");
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
    <div className="ss-livecam" ref={containerRef}>
      <video ref={videoRef} className="ss-livecam-video" autoPlay muted playsInline />
      {flash && <div className="ss-livecam-flash" />}

      <div className="ss-livecam-top">
        <button className="ss-livecam-close" onClick={close}><X size={20} /></button>
        <span className="ss-livecam-label">{label}</span>
        {state === "ready" && lenses.length > 1 && (
          <button className="ss-livecam-lens" onClick={switchLens} title={activeLabel ? `Lens: ${activeLabel} — tap for the next one` : "Try the other camera lens"}>
            <SwitchCamera size={16} />
            <span>{Math.max(0, lenses.findIndex((d) => d.deviceId === activeLensId)) + 1}/{lenses.length}</span>
          </button>
        )}
        {onToggleFieldMode && (
          <button className="ss-livecam-lens" onClick={onToggleFieldMode} title="Field mode — high-contrast for bright daylight">
            {fieldMode ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        )}
        <span className="ss-livecam-count">{count}</span>
      </div>

      {/* Rate the room without leaving the viewfinder — closing the camera
          just to tap Good/Fair/Poor and reopening it was the single most
          repeated "jarring" moment in a camera-first flow. */}
      {state === "ready" && onCondition && (
        <div className="ss-livecam-cond">
          {CONDITIONS.map((c) => (
            <button key={c}
              className={`${c.toLowerCase()} ${condition === c ? "on" : ""}`}
              onClick={() => { tapFeedback("light"); onCondition(condition === c ? null : c); }}>
              {c}
            </button>
          ))}
        </div>
      )}

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
        <div className="ss-livecam-zoom">
          <button className="ss-livecam-wide" onClick={wideShot}
            title="One wide-angle shot with the phone's own camera app, then straight back here">
            <Expand size={14} /> Wide shot
          </button>
          {zoomCaps && (
            <>
              <span className="ss-livecam-zoom-label">{(zoom * lensScale).toFixed(1)}×</span>
              <input
                type="range"
                className="ss-livecam-zoom-slider"
                min={zoomCaps.min}
                max={zoomCaps.max}
                step={zoomCaps.step}
                value={zoom}
                onChange={(e) => applyZoom(parseFloat(e.target.value))}
                aria-label="Zoom"
              />
            </>
          )}
        </div>
      )}

      {state === "ready" && (
        <div className="ss-livecam-bottom">
          {(lastThumb || justTaken) && <img className="ss-livecam-last" src={lastThumb || justTaken} alt="" />}
          <button className="ss-livecam-shutter" onClick={capture} aria-label="Take photo" />
          <button className="ss-livecam-switch" onClick={() => { stopStream(); onFallback(); }} aria-label="Use phone's camera app instead" title="Use phone's camera app instead">
            <RefreshCw size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export const BAD_IMAGE_MSG = "That image couldn't be read, so it wasn't added — try the shot again.";

export function WalkScreen({ rooms, index, photoCache, onIndex, onCapture, onDeleteLast, onMeta, onAddMemo, onDeleteMemo, onExit, onError, filing, fieldMode, onToggleFieldMode }) {
  const inputRef = useRef(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [resumeKey, setResumeKey] = useState(0);
  const room = rooms[index];
  const count = room.photoIds.length;
  const lastId = room.photoIds[count - 1];
  const last = lastId ? photoCache[lastId] : null;
  const isLast = index === rooms.length - 1;
  const nextExhibitNo = count + 1;

  useEffect(() => { setNoteOpen(false); setCameraOpen(false); }, [index]);

  function openCamera() {
    setCameraOpen(true);
  }

  // Swipe left/right between rooms — the same move as flicking through
  // Photos. Ignored when the touch starts on something with its own
  // gesture or that needs the finger (a button, the note textarea, the
  // voice-memo controls), and while the camera overlay is open (its own
  // pinch/pan handlers own touches then).
  const swipeStart = useRef(null);
  function onBodyTouchStart(e) {
    if (cameraOpen || e.touches.length !== 1) { swipeStart.current = null; return; }
    if (e.target.closest("button, textarea, input, .ss-vm")) { swipeStart.current = null; return; }
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  }
  function onBodyTouchEnd(e) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && !isLast) { tapFeedback("light"); onIndex(index + 1); }
    else if (dx > 0 && index > 0) { tapFeedback("light"); onIndex(index - 1); }
  }

  async function handleFile(e) {
    // Some cameras and the gallery hand back several files at once; take them
    // all, in the order chosen.
    const files = Array.from((e.target.files) || []);
    e.target.value = "";
    setResumeKey((k) => k + 1);
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
          lastThumb={last ? (last.thumb || last.dataUrl) : null}
          resumeKey={resumeKey}
          onCapture={onCapture}
          onClose={() => setCameraOpen(false)}
          onFallback={() => { setCameraOpen(false); inputRef.current && inputRef.current.click(); }}
          onWideShot={() => { inputRef.current && inputRef.current.click(); }}
          condition={room.condition || null}
          onCondition={(c) => onMeta({ condition: c })}
          fieldMode={fieldMode}
          onToggleFieldMode={onToggleFieldMode}
        />
      )}

      <div className="ss-live-top">
        <button className="ss-live-exit" onClick={onExit}><X size={18} /> Exit</button>
        <span className="ss-live-flag">● LIVE</span>
        {onToggleFieldMode && (
          <button className="ss-live-fieldmode" onClick={onToggleFieldMode} title="Field mode — high-contrast for bright daylight">
            {fieldMode ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        )}
      </div>

      <div className="ss-live-body" onTouchStart={onBodyTouchStart} onTouchEnd={onBodyTouchEnd}>
        <div className="ss-live-eyebrow">Room {pad(index + 1)} of {pad(rooms.length)}</div>
        <div className="ss-live-room">{room.name}</div>
        <span className="ss-live-stamp">Next: Exhibit {nextExhibitNo}</span>
        {filing && filing.provider && (
          <span className="ss-live-filing">
            {filing.pending > 0 ? `Filing ${filing.pending} to ${filing.provider === "ms" ? "OneDrive" : "Drive"}…` : `Files itself to ${filing.provider === "ms" ? "OneDrive" : "Drive"}`}
          </span>
        )}
        <div className="ss-tally">{count}</div>
        <div className="ss-live-sub">photo{count === 1 ? "" : "s"} in this room</div>

        <div className="ss-live-cond">
          {CONDITIONS.map((c) => (
            <button key={c}
              className={`${c.toLowerCase()} ${room.condition === c ? "on" : ""}`}
              title={`Rate this room ${c} — shown in the report and sent to the AI drafting step`}
              onClick={() => { tapFeedback("light"); onMeta({ condition: room.condition === c ? null : c }); }}>
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
