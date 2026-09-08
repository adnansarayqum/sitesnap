import { createPortal } from "react-dom";
import {
  Camera, Printer, X,
} from "lucide-react";
import { pad } from "../lib/util.js";
import { approvedByRoom } from "../ai.js";

const money = (n) => `£${Math.round(n).toLocaleString("en-GB")}`;

/* ---------------- printable report ---------------- */

// Rendered through a portal straight onto <body>, not inside the case
// file's own screen tree: that tree sits under a wrapper the print
// stylesheet hides wholesale (`.ss-col { display: none }`) to keep the app
// chrome off the page, and a `display: none` ancestor takes this report
// down with it — the browser's "print" and "save as PDF" both end up
// blank. Outside that tree, the report prints on its own.
export function ReportView({ inspection, rooms, photoCache, onClose }) {
  const totalPhotos = rooms.reduce((s, r) => s + r.photoIds.length, 0);
  const covered = rooms.filter((r) => r.photoIds.length > 0).length;
  const date = new Date(inspection.startedAt).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  // only what the surveyor approved reaches the report; numbered through the
  // whole property so the schedule and the report agree on "Finding 4"
  const approvedFindings = approvedByRoom(inspection.findings, rooms);
  const findingIndex = new Map();
  let fn = 0;
  for (const r of approvedFindings) r.findings.forEach((f, i) => { fn += 1; findingIndex.set(`${r.roomId}:${i}`, fn); });
  const findingNo = (roomId, i) => `Finding ${findingIndex.get(`${roomId}:${i}`)}`;
  const totalFindings = fn;
  return createPortal((
    <div className="ss-report">
      <div className="ss-report-bar ss-noprint">
        <button className="close" onClick={onClose}><X size={16} /> Close</button>
        <button className="print" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>
      </div>
      <div className="ss-report-page">
        <header className="ss-rep-head">
          <div className="ss-rep-brand"><Camera size={15} strokeWidth={2.6} /> SiteSnap</div>
          <h1>{inspection.address}{inspection.postcode ? `, ${inspection.postcode}` : ""}</h1>
          <div className="ss-rep-meta">
            <span>Photo inspection report</span>
            <span>{date}</span>
            <span>{totalPhotos} photo{totalPhotos === 1 ? "" : "s"} · {covered} of {rooms.length} areas{totalFindings ? ` · ${totalFindings} finding${totalFindings === 1 ? "" : "s"}` : ""}</span>
          </div>
          {(inspection.ref || inspection.client || inspection.occupier || inspection.solicitor) && (
            <dl className="ss-rep-case">
              {inspection.ref && (<><dt>Reference</dt><dd>{inspection.ref}</dd></>)}
              {inspection.client && (<><dt>Client</dt><dd>{inspection.client}</dd></>)}
              {inspection.occupier && (<><dt>Occupier</dt><dd>{inspection.occupier}</dd></>)}
              {inspection.solicitor && (<><dt>Solicitor</dt><dd>{inspection.solicitor}</dd></>)}
            </dl>
          )}
        </header>
        {rooms.map((room, i) => {
          const photos = room.photoIds.map((id) => photoCache[id]).filter(Boolean);
          const findings = (approvedFindings.find((r) => r.roomId === room.id) || { findings: [] }).findings;
          if (!photos.length && !room.condition && !(room.note && room.note.trim()) && !findings.length) return null;
          return (
            <section key={room.id} className="ss-rep-room">
              <div className="ss-rep-room-head">
                <h2>{pad(i + 1)}. {room.name}</h2>
                {room.condition && <span className={`ss-cbadge ${room.condition.toLowerCase()}`}>{room.condition}</span>}
                <span className="ss-rep-count">{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
              </div>
              {room.note && room.note.trim() && <p className="ss-rep-note">{room.note.trim()}</p>}
              {findings.map((f, fi) => (
                <div key={f.id || fi} className="ss-rep-finding">
                  <div className="ss-rep-finding-head">
                    <span className="ss-rep-finding-n">{findingNo(room.id, fi)}</span>
                    <strong>{f.title}</strong>
                    {f.legislation.length > 0 && <span className="ss-rep-finding-leg">{f.legislation.join(" · ")}{f.hhsrs_hazard ? ` · ${f.hhsrs_hazard}` : ""}</span>}
                  </div>
                  <p><em>Defect.</em> {f.defect}</p>
                  {f.assessment.likely_cause && <p><em>Cause.</em> {f.assessment.likely_cause}</p>}
                  <p><em>Remedial works.</em> {f.remedial.works}{(f.remedial.conditions || []).length ? ` (${f.remedial.conditions.join("; ")})` : ""}</p>
                  <p className="ss-rep-finding-cost">
                    <em>Estimated cost.</em> {f.cost.unpriced ? "To be confirmed" : `${money(f.cost.low)} – ${money(f.cost.high)}`}
                    {f.photo_refs.length > 0 && <span> · Photos {f.photo_refs.join(", ")}</span>}
                  </p>
                </div>
              ))}
              {photos.length > 0 && (
                <div className="ss-rep-grid">
                  {photos.map((p) => (
                    <figure key={p.id}>
                      <img src={p.dataUrl} alt="" />
                      {(p.no || (p.caption && p.caption.trim())) ? (
                        <figcaption>{p.no ? `Photo ${p.no}` : ""}{p.caption && p.caption.trim() ? `${p.no ? " — " : ""}${p.caption.trim()}` : ""}</figcaption>
                      ) : null}
                    </figure>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <footer className="ss-rep-foot">
          Generated with SiteSnap · {new Date().toLocaleDateString("en-GB")}
        </footer>
      </div>
    </div>
  ), document.body);
}
