import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, MessageSquare, X } from "lucide-react";
import { FEEDBACK_KINDS, sendFeedback } from "../telemetry.js";

// One tap to say what happened, in the surveyor's words, with the context
// the founder needs to act on it (screen, case, finding, version) and none
// of the evidence.
export function FeedbackSheet({ screen, caseId, findingId, preset, onClose, onSent }) {
  const [kind, setKind] = useState(preset || null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function send() {
    if (!kind) return;
    setBusy(true); setError(null);
    try { await sendFeedback({ kind, text, screen, caseId, findingId }); onSent && onSent(); onClose(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return createPortal((
    <div className="ss-modal-back" onClick={onClose}>
      <div className="ss-modal ss-modal-left ss-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ss-sheet-head">
          <div className="ss-modal-title" style={{ margin: 0 }}>{findingId ? "About this finding" : "Tell us what happened"}</div>
          <button className="ss-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="ss-sheet-body">
          <div className="ss-fb-kinds">
            {FEEDBACK_KINDS.filter(([k]) => findingId ? !["slowed_me_down", "missing_feature"].includes(k) : true).map(([k, label]) => (
              <button key={k} className={`ss-ichip ${kind === k ? "on active" : ""}`} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
          <textarea className="ss-note-input" rows={3} placeholder="Anything else — what you expected, what you got (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          <p className="ss-fineprint">Sent with the screen, case and finding ids and the app version — not your photos, notes or transcripts.</p>
          {error && <p className="ss-fineprint" style={{ color: "var(--red)" }}>{error}</p>}
          <button className="ss-btn ss-btn-primary ss-btn-big" disabled={!kind || busy} onClick={send}>{busy ? <Loader2 size={16} className="ss-spin" /> : <Check size={16} />} Send</button>
        </div>
      </div>
    </div>
  ), document.querySelector(".ss-root") || document.body);
}

export function FeedbackButton({ screen, caseId, findingId, preset, className, children, onSent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className || "ss-link"} onClick={() => setOpen(true)}><MessageSquare size={13} /> {children || "Feedback"}</button>
      {open && <FeedbackSheet screen={screen} caseId={caseId} findingId={findingId} preset={preset} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  );
}
