// A compact case row for a list: address, case number, date, status,
// photo count and — for an open case being walked — progress through its
// rooms. Used by Home's recent-inspections list and the Cases register.
// `reference` and `onDelete` are optional — passing neither renders exactly
// the bare card Home has always used, so this stays a safe extension.
import { Trash2 } from "lucide-react";
import { StatusPill } from "./StatusPill.jsx";
import { ProgressBar } from "./ProgressBar.jsx";

export function InspectionCard({ address, caseNo, reference, date, photos, rooms, doneRooms, status, onClick, onDelete, disabled, title }) {
  const showProgress = typeof rooms === "number" && rooms > 0 && typeof doneRooms === "number";
  const card = (
    <button className="ss-icard" onClick={onClick} disabled={disabled} title={title}>
      <div className="ss-icard-top">
        <span className="ss-icard-case">{caseNo ? `Case ${caseNo}` : "No case number yet"}</span>
        {date && <span className="ss-icard-date">{date}</span>}
      </div>
      <div className="ss-icard-address">{address}</div>
      {reference && <div className="ss-icard-ref">{reference}</div>}
      <div className="ss-icard-meta">
        <span>{photos} photo{photos === 1 ? "" : "s"}</span>
        {status && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
      </div>
      {showProgress && (
        <div className="ss-icard-progress">
          <ProgressBar value={(doneRooms / rooms) * 100} label={`${doneRooms} of ${rooms} rooms covered`} />
          <span>{doneRooms} of {rooms} rooms</span>
        </div>
      )}
    </button>
  );
  if (!onDelete) return card;
  return (
    <div className="ss-icard-row">
      {card}
      <button className="ss-job-x" onClick={onDelete} aria-label={`Discard ${address}`} title="Discard this inspection"><Trash2 size={16} /></button>
    </div>
  );
}
