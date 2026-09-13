// Shown once, right after "Finish inspection" — the moment capture turns
// into delivery. A plain summary of what was covered, then straight to
// the two things a surveyor actually does next: review what the AI
// drafted, or get the report out the door.
import { Check, FileText, ShieldCheck } from "lucide-react";
import { inspectionHealth } from "../findings.js";
import { AppHeader, Button, StickyActionBar } from "../ui/index.js";

function formatDuration(ms) {
  if (!(ms > 0)) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h${m ? ` ${m}m` : ""}`;
}

export function CompleteScreen({ inspection, rooms, totalPhotos, onReviewFindings, onExportReport, onContinue }) {
  const health = inspectionHealth(inspection, rooms);
  const duration = formatDuration((inspection.completedAt || Date.now()) - (inspection.startedAt || inspection.completedAt || Date.now()));
  return (
    <div className="ss-col">
      <AppHeader title="Inspection complete" onBack={onContinue} />
      <div className="ss-scroll">
        <div className="ss-complete-hero">
          <span className="ss-complete-check"><Check size={26} strokeWidth={3} /></span>
          <h1>Inspection complete</h1>
          <p>{inspection.address}{inspection.postcode ? `, ${inspection.postcode}` : ""}</p>
        </div>
        <div className="ss-stat-row">
          <div className="ss-stat-tile"><span className="ss-stat-value">{totalPhotos}</span><span className="ss-stat-label">Photo{totalPhotos === 1 ? "" : "s"}</span></div>
          <div className="ss-stat-tile"><span className="ss-stat-value">{health.doneRooms}/{health.rooms}</span><span className="ss-stat-label">Rooms</span></div>
          <div className="ss-stat-tile"><span className="ss-stat-value">{duration}</span><span className="ss-stat-label">Duration</span></div>
        </div>
        {health.findingsTotal > 0 && (
          <p className="ss-complete-findings"><ShieldCheck size={14} /> {health.findingsApproved} of {health.findingsTotal} finding{health.findingsTotal === 1 ? "" : "s"} reviewed</p>
        )}
      </div>
      <StickyActionBar>
        <Button variant="primary" size="big" onClick={onExportReport}><FileText size={18} /> Export report</Button>
        <Button variant="ghost" onClick={onReviewFindings}>Review findings</Button>
      </StickyActionBar>
    </div>
  );
}
