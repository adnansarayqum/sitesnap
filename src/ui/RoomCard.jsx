// One room in the Rooms tab: name, photo and issue counts, condition, and
// whether the surveyor has marked it complete. Meant to be the row content
// inside a ReorderableList (which renders the drag handle and the tap
// target around it), so this returns a Fragment, not its own <button>.
import { Check, Image as ImageIcon, StickyNote } from "lucide-react";
import { pad } from "../lib/util.js";

export function RoomCard({ index, name, photos, issues, condition, complete, hasNote, thumb }) {
  return (
    <>
      <div className="ss-roomcard-main">
        <div className="ss-roomcard-top">
          <span className="ss-index">{pad(index + 1)}</span>
          <span className="ss-row-name">{name}</span>
          {hasNote ? <StickyNote size={12} className="ss-note-flag" /> : null}
        </div>
        <div className="ss-roomcard-meta">
          {photos > 0 ? (
            <span>{photos} photo{photos === 1 ? "" : "s"}{issues > 0 ? ` · ${issues} issue${issues === 1 ? "" : "s"}` : ""}</span>
          ) : (
            <span className="ss-roomcard-todo">Not started</span>
          )}
        </div>
      </div>
      <div className="ss-roomcard-right">
        {condition && <span className={`ss-cbadge ${condition.toLowerCase()}`}>{condition}</span>}
        {complete ? (
          <span className="ss-roomcard-done"><Check size={12} /> Complete</span>
        ) : thumb ? (
          <img src={thumb} alt="" className="ss-thumb" />
        ) : photos === 0 ? (
          <span className="ss-thumb ss-thumb-empty"><ImageIcon size={13} /></span>
        ) : null}
      </div>
    </>
  );
}
