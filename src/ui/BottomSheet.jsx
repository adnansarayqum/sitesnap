// A sheet with a titled head, a close button and a body. `portal` mounts
// it on .ss-root (where the typeface and colour tokens live) so it can be
// opened from deep inside a scrolling list; `after` renders siblings over
// the same scrim (a picker opened from within the sheet).
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const cx = (...parts) => parts.filter(Boolean).join(" ");

export function BottomSheet({ title, onClose, className, bodyClassName, portal, after, children }) {
  const sheet = (
    <div className="ss-modal-back" onClick={onClose}>
      <div className={cx("ss-modal ss-modal-left ss-sheet", className)} onClick={(e) => e.stopPropagation()}>
        <div className="ss-sheet-head">
          <div className="ss-modal-title" style={{ margin: 0 }}>{title}</div>
          <button className="ss-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className={cx("ss-sheet-body", bodyClassName)}>{children}</div>
      </div>
      {after || null}
    </div>
  );
  return portal ? createPortal(sheet, document.querySelector(".ss-root") || document.body) : sheet;
}
