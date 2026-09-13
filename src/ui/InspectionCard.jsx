// A compact case row for a list: address, case number, date, status,
// photo count and — for an open case being walked — progress through its
// rooms. Used by Home's recent-inspections list.
import { StatusPill } from "./StatusPill.jsx";
import { ProgressBar } from "./ProgressBar.jsx";

export function InspectionCard({ address, caseNo, date, photos, rooms, doneRooms, status, onClick }) {
  const showProgress = typeof rooms === "number" && rooms > 0 && typeof doneRooms === "number";
  return (
    <button className="ss-icard" onClick={onClick}>
      <div className="ss-icard-top">
        <span className="ss-icard-case">{caseNo ? `Case ${caseNo}` : "No case number yet"}</span>
        {date && <span className="ss-icard-date">{date}</span>}
      </div>
      <div className="ss-icard-address">{address}</div>
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
}
