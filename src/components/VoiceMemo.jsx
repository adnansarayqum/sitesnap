import { useEffect, useRef, useState } from "react";
import {
  Mic, MicOff, X,
} from "lucide-react";
import { tapFeedback } from "../haptics.js";

/* ---------- voice memos ---------- */

export function canRecord() {
  return typeof navigator !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    && typeof MediaRecorder !== "undefined";
}

export function pickAudioType() {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
}

export function extFor(mime) {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export function mmss(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Records on the device and keeps the blob locally — works with no signal,
// which browser speech-to-text does not. Transcription happens in the cloud
// workflow after upload.
export function VoiceMemo({ memos, onAdd, onDelete, dark }) {
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
      tapFeedback("medium");
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
    if (rec.current && rec.current.state === "recording") { rec.current.stop(); tapFeedback("medium"); }
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
