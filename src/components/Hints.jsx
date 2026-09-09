import { useState } from "react";
import { createPortal } from "react-dom";
import { Info, Lightbulb, X } from "lucide-react";

// First-time guidance that stays out of the way: one short card per screen,
// inline with the content (never an overlay that blocks a button), shown
// once and remembered on this device. Plus a tappable (i) for the two AI
// actions, since a phone has no hover and a `title=` attribute is invisible
// there. Settings can bring the cards back.
const PREFIX = "sitesnap:hint:";

function seen(id) { try { return localStorage.getItem(PREFIX + id) === "1"; } catch { return false; } }
function markSeen(id) { try { localStorage.setItem(PREFIX + id, "1"); } catch { /* private mode — it'll show again, which is fine */ } }

export function resetHints() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* nothing to reset */ }
}

export function Coach({ id, title, children, dark = false }) {
  const [hidden, setHidden] = useState(() => seen(id));
  if (hidden) return null;
  return (
    <div className={`ss-coach ${dark ? "dark" : ""}`} role="note">
      <Lightbulb size={16} className="ss-coach-ic" />
      <div className="ss-coach-main">
        <div className="ss-coach-title">{title}</div>
        <div className="ss-coach-body">{children}</div>
        <button className="ss-coach-btn" onClick={() => { markSeen(id); setHidden(true); }}>Got it</button>
      </div>
    </div>
  );
}

export function InfoTip({ title, children, label = "What this does" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ss-infotip" onClick={() => setOpen(true)} aria-label={`${label}: ${title}`} title={title}>
        <Info size={13} />
      </button>
      {/* portalled into .ss-root, not body: that's where the typeface and the
          light/field-mode colour tokens live */}
      {open && createPortal((
        <div className="ss-modal-back" onClick={() => setOpen(false)}>
          <div className="ss-modal ss-modal-left ss-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ss-sheet-head">
              <div className="ss-modal-title" style={{ margin: 0 }}>{title}</div>
              <button className="ss-sheet-close" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="ss-sheet-body">{children}</div>
          </div>
        </div>
      ), document.querySelector(".ss-root") || document.body)}
    </>
  );
}
