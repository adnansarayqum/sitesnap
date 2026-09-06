import { createPortal } from "react-dom";
import {
  Camera, Printer, X,
} from "lucide-react";
import { pad } from "../lib/util.js";

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
            <span>{totalPhotos} photo{totalPhotos === 1 ? "" : "s"} · {covered} of {rooms.length} areas</span>
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
          if (!photos.length && !room.condition && !(room.note && room.note.trim())) return null;
          return (
            <section key={room.id} className="ss-rep-room">
              <div className="ss-rep-room-head">
                <h2>{pad(i + 1)}. {room.name}</h2>
                {room.condition && <span className={`ss-cbadge ${room.condition.toLowerCase()}`}>{room.condition}</span>}
                <span className="ss-rep-count">{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
              </div>
              {room.note && room.note.trim() && <p className="ss-rep-note">{room.note.trim()}</p>}
              {photos.length > 0 && (
                <div className="ss-rep-grid">
                  {photos.map((p) => (
                    <figure key={p.id}>
                      <img src={p.dataUrl} alt="" />
                      {p.no ? <figcaption>Photo {p.no}</figcaption> : null}
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
