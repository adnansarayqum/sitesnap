import { useEffect, useState } from "react";
import { Loader2, CloudUpload, CircleCheck, X } from "lucide-react";
import { TopBar } from "../components/shared.jsx";
import { fetchRemoteCase } from "../sync.js";
import { relativeDay } from "./Home.jsx";

/* ---------------- a colleague's case, from the register ---------------- */
// Read-only: the full-size photos are on their phone and in their drive;
// this is the register's copy — details, rooms, conditions, notes and
// thumbnails — for anyone in the firm to check without ringing them.

export function RemoteCaseScreen({ id, onBack }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchRemoteCase(id).then((data) => { if (!cancelled) setC(data); }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return (
      <div className="ss-col">
        <TopBar title="Case" eyebrow="Register" onBack={onBack} />
        <div className="ss-scroll"><p className="ss-empty-note">Couldn't load this case: {error}</p></div>
      </div>
    );
  }
  if (!c) return <div className="ss-center"><Loader2 className="ss-spin" size={26} /></div>;

  const doc = c.doc || {};
  const rooms = doc.rooms || [];
  const byId = Object.fromEntries((c.photos || []).map((p) => [p.id, p]));
  const details = [
    ["Reference", doc.ref], ["Client", doc.client], ["Occupier", doc.occupier], ["Solicitor", doc.solicitor],
  ].filter(([, v]) => v);
  const up = doc.lastUpload;

  return (
    <div className="ss-col">
      <TopBar
        title={c.address}
        eyebrow={`${c.case_no ? `Case No. ${c.case_no} · ` : ""}by ${c.created_by_name || "a colleague"}`}
        onBack={onBack}
      />
      <div className="ss-scroll">
        <div className="ss-case-cover">
          <div className="ss-case-cover-head">
            <span className="ss-stamp">{c.status === "closed" ? "Closed" : "In progress"}</span>
            {up && (
              <span className={`ss-job-up ${up.ok ? "ok" : "bad"}`}>
                {up.ok ? <CircleCheck size={11} /> : <X size={11} />}
                {up.ok ? (up.confirmed ? "Filed" : "Sent, not confirmed") : "Upload incomplete"}
              </span>
            )}
          </div>
          <div className="ss-case-kv-grid">
            {details.map(([label, value]) => (
              <div key={label}><div className="ss-kv-label">{label}</div><div className="ss-kv-value">{value}</div></div>
            ))}
            {c.started_at && <div><div className="ss-kv-label">Started</div><div className="ss-kv-value">{relativeDay(new Date(c.started_at).getTime())}</div></div>}
            {c.closed_at && <div><div className="ss-kv-label">Closed</div><div className="ss-kv-value">{relativeDay(new Date(c.closed_at).getTime())}</div></div>}
            <div><div className="ss-kv-label">Areas</div><div className="ss-kv-value">{rooms.length}</div></div>
            <div><div className="ss-kv-label">Photos</div><div className="ss-kv-value">{(c.photos || []).length}</div></div>
          </div>
        </div>
        <p className="ss-fineprint" style={{ margin: "10px 2px 0" }}>
          <CloudUpload size={12} style={{ verticalAlign: "-2px" }} /> Register copy. The full-size photos are on {c.created_by_name || "their"}'s phone and in their drive.
        </p>

        {rooms.map((r) => (
          <div key={r.id} className="ss-remote-room">
            <div className="ss-remote-room-head">
              <span className="ss-row-name">{r.name}</span>
              {r.condition && <span className={`ss-cond-pill ${r.condition.toLowerCase()}`}>{r.condition}</span>}
            </div>
            {r.note && <p className="ss-remote-note">{r.note}</p>}
            {(r.photoIds || []).length > 0 && (
              <div className="ss-remote-grid">
                {r.photoIds.map((pid) => {
                  const p = byId[pid];
                  return (
                    <figure key={pid} className="ss-remote-thumb">
                      {p && p.has_thumb ? <img src={`/api/photos/${encodeURIComponent(pid)}/thumb`} alt="" loading="lazy" /> : <div className="ss-remote-thumb-empty" />}
                      <figcaption>{p && p.no ? `Exhibit ${p.no}` : ""}{p && p.caption ? ` · ${p.caption}` : ""}</figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {doc.activity && doc.activity.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 20 }}>Case activity</div>
            <div className="ss-activity">
              {[...doc.activity].reverse().slice(0, 15).map((a, i) => (
                <div key={i} className="ss-activity-row">
                  <span className="ss-activity-time">{relativeDay(a.ts)}</span>
                  <span className="ss-activity-dot" />
                  <span className="ss-activity-text">{a.text}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}
