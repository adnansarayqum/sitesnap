import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Camera, CircleCheck, CloudUpload, Download, FolderTree, Home as HomeIcon, Plus, Search, Settings as SettingsIcon, Smartphone, Trash2, X,
} from "lucide-react";
import {
  loadInspection, loadPhoto,
} from "../storage.js";

/* ---------------- home ---------------- */

/* ---------------- top-level tab bar ---------------- */

export function TabBar({ active, onChange }) {
  const tabs = [
    ["home", "Home", HomeIcon],
    ["cases", "Cases", FolderTree],
    ["settings", "Settings", SettingsIcon],
  ];
  return (
    <div className="ss-tabbar">
      {tabs.map(([key, label, Icon]) => (
        <button key={key} className={`ss-tabbar-item ${active === key ? "on" : ""}`} onClick={() => onChange(key)}>
          <Icon size={19} strokeWidth={active === key ? 2.2 : 1.8} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function HomeScreen({ index, onNew, onOpen, onTab }) {
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const active = open[0] || null;
  const others = open.slice(1, 5);
  const [activity, setActivity] = useState([]);
  const [thumbs, setThumbs] = useState([]);

  useEffect(() => {
    if (!active) { setActivity([]); setThumbs([]); return; }
    let cancelled = false;
    (async () => {
      const data = await loadInspection(active.id);
      if (cancelled || !data) return;
      setActivity([...(data.inspection.activity || [])].reverse().slice(0, 4));
      const ids = (data.rooms || []).flatMap((r) => r.photoIds).slice(-4).reverse();
      const thumbList = await Promise.all(ids.map(async (pid) => {
        const p = await loadPhoto(pid);
        return p ? (p.thumb || p.dataUrl) : null;
      }));
      if (!cancelled) setThumbs(thumbList.filter(Boolean));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active && active.id, active && active.updatedAt]);

  if (!active) {
    return (
      <div className="ss-col">
        <div className="ss-home-hero">
          <div className="ss-mark"><Camera size={20} strokeWidth={2.4} /></div>
          <div className="ss-eyebrow">Property inspections</div>
          <h1 className="ss-h1">Every photo,<br />already filed.</h1>
          <p className="ss-lede">
            Pick the rooms, walk the property, shoot as you go. Photos file
            themselves into numbered room folders — rate each room, add notes,
            and export everything in one tap at the end.
          </p>
          <div className="ss-home-steps">
            <div><span className="ss-step-n">1</span> Set up the property</div>
            <div><span className="ss-step-n">2</span> Walk, shoot &amp; rate each room</div>
            <div><span className="ss-step-n">3</span> Export — Photos, ZIP, OneDrive, PDF report</div>
          </div>
        </div>
        <div className="ss-footer">
          <button className="ss-btn ss-btn-primary ss-btn-big" onClick={onNew}>
            <Plus size={20} strokeWidth={2.6} /> New inspection
          </button>
        </div>
        <TabBar active="home" onChange={onTab} />
      </div>
    );
  }

  return (
    <div className="ss-col">
      <div className="ss-home-top">
        <div>
          <div className="ss-eyebrow-sm">SiteSnap</div>
          <div className="ss-title-lg">Dashboard</div>
        </div>
      </div>

      <div className="ss-scroll">
        <button className="ss-case-hero" onClick={() => onOpen(active.id)}>
          <div className="ss-case-hero-head">
            <span className="ss-stamp light">Case No. {active.caseNo || "—"}</span>
            <span className="ss-case-hero-time">{relativeDay(active.updatedAt)}</span>
          </div>
          <div className="ss-case-hero-title">{active.address}</div>
          <div className="ss-case-hero-sub">
            {active.postcode ? active.postcode + " · " : ""}{active.photos} photo{active.photos === 1 ? "" : "s"} · {active.rooms} area{active.rooms === 1 ? "" : "s"}
          </div>
          {thumbs.length > 0 && (
            <div className="ss-case-hero-collage">
              {thumbs.map((t, i) => <img key={i} src={t} alt="" />)}
            </div>
          )}
          <div className="ss-case-hero-cta"><span>Resume case</span><ArrowRight size={15} /></div>
        </button>

        {activity.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 20 }}>Recent activity</div>
            <div className="ss-activity">
              {activity.map((a, i) => (
                <div key={i} className="ss-activity-row">
                  <span className="ss-activity-time">
                    {new Date(a.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="ss-activity-dot" />
                  <span className="ss-activity-text">{a.text}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {others.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 20 }}>Also in progress</div>
            <div className="ss-list">
              {others.map((i) => (
                <button key={i.id} className="ss-row ss-row-tap-full" onClick={() => onOpen(i.id)}>
                  <span className="ss-row-name">{i.address}</span>
                  <span className="ss-pill done">{i.photos}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 16 }} />
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-primary ss-btn-big" onClick={onNew}>
          <Plus size={20} strokeWidth={2.6} /> New inspection
        </button>
      </div>
      <TabBar active="home" onChange={onTab} />
    </div>
  );
}

export function CasesScreen({ index, archive, durable, onNew, onOpen, onDiscard, onTab }) {
  const [confirmId, setConfirmId] = useState(null);
  const [q, setQ] = useState("");
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const target = open.find((i) => i.id === confirmId);

  const done = archive || [];
  const needle = q.trim().toLowerCase();
  const matches = (i) => !needle || [i.address, i.ref, i.postcode].filter(Boolean).join(" ").toLowerCase().includes(needle);
  const openShown = open.filter(matches);
  const doneShown = done.filter(matches);

  if (open.length === 0 && done.length === 0) {
    return (
      <div className="ss-col">
        <div className="ss-home-top">
          <div>
            <div className="ss-eyebrow-sm">Register</div>
            <div className="ss-title-lg">All cases</div>
          </div>
        </div>
        <div className="ss-scroll">
          <p className="ss-empty-note">No cases yet. Start your first inspection below.</p>
        </div>
        <div className="ss-footer">
          <button className="ss-btn ss-btn-primary ss-btn-big" onClick={onNew}>
            <Plus size={20} strokeWidth={2.6} /> New inspection
          </button>
        </div>
        <TabBar active="cases" onChange={onTab} />
      </div>
    );
  }

  return (
    <div className="ss-col">
      <div className="ss-topbar">
        <span className="ss-tick" />
        <div className="ss-topbar-text">
          <div className="ss-eyebrow-sm">Register</div>
          <div className="ss-title">All cases</div>
        </div>
        <span className="ss-badge">{open.length}</span>
      </div>

      <div className="ss-search-row">
        <Search size={15} className="ss-search-ic" />
        <input className="ss-search-input" placeholder="Search address, ref, postcode…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="ss-search-clear" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
      </div>

      <div className="ss-scroll">
        {needle && openShown.length === 0 && doneShown.length === 0 && (
          <p className="ss-empty-note">Nothing matches “{q.trim()}”.</p>
        )}
        <div className="ss-list">
          {openShown.map((i) => (
            <div key={i.id} className="ss-row">
              <button className="ss-row-tap" onClick={() => onOpen(i.id)}>
                <div className="ss-row-main ss-job">
                  <span className="ss-row-name">{i.address}</span>
                  <span className="ss-job-sub">
                    {i.ref ? i.ref + " · " : i.postcode ? i.postcode + " · " : ""}
                    {i.photos} photo{i.photos === 1 ? "" : "s"} · {i.rooms} area{i.rooms === 1 ? "" : "s"}
                    {" · "}{relativeDay(i.startedAt)}
                  </span>
                  {i.lastUpload && (
                    <span className={`ss-job-up ${i.lastUpload.ok ? "ok" : "bad"}`} title={
                      i.lastUpload.ok
                        ? (i.lastUpload.confirmed ? "Confirmed as filed by your cloud workflow" : "Sent, but your workflow hasn't confirmed it's filed yet")
                        : "The last upload attempt didn't finish — open this inspection to retry"
                    }>
                      {i.lastUpload.ok ? <CircleCheck size={11} /> : <X size={11} />}
                      {i.lastUpload.ok ? (i.lastUpload.confirmed ? "Filed" : "Sent, not confirmed") : "Upload incomplete"}
                    </span>
                  )}
                </div>
              </button>
              <button className="ss-job-x" onClick={() => setConfirmId(i.id)} aria-label={`Discard ${i.address}`} title="Discard this inspection">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        {durable === false && (
          <div className="ss-tip">
            <Smartphone size={14} />
            <span>
              Add SiteSnap to your home screen (Share → Add to Home Screen). It
              stops the browser clearing photos you haven't uploaded yet.
            </span>
          </div>
        )}
        {open.length === 0 && !needle && (
          <p className="ss-empty-note">Nothing in progress. Start a new inspection below.</p>
        )}

        {doneShown.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 22 }}>Completed</div>
            <div className="ss-list">
              {doneShown.slice(0, 25).map((a) => (
                <div key={a.id} className="ss-row ss-row-done">
                  <div className="ss-row-tap">
                    <div className="ss-row-main ss-job">
                      <span className="ss-row-name">{a.address}</span>
                      <span className="ss-job-sub">
                        {a.ref ? a.ref + " · " : ""}{a.photos} photo{a.photos === 1 ? "" : "s"}
                        {" · closed "}{relativeDay(a.closedAt)}
                      </span>
                      <span className={`ss-job-up ${a.lastUpload && a.lastUpload.confirmed ? "ok" : a.lastUpload ? "warn" : "bad"}`} title={
                        a.lastUpload
                          ? (a.lastUpload.confirmed ? "Your cloud workflow confirmed every file was filed" : "The upload was accepted but never confirmed as filed — worth checking OneDrive")
                          : a.lastExport ? "Saved as a ZIP or to Photos, but never sent to the cloud" : "This inspection was closed without exporting or uploading it anywhere"
                      }>
                        {a.lastUpload
                          ? (a.lastUpload.confirmed ? <><CircleCheck size={11} /> Filed in the cloud</> : <><CloudUpload size={11} /> Sent, not confirmed</>)
                          : a.lastExport ? <><Download size={11} /> Exported only</> : <><X size={11} /> Never uploaded</>}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="ss-fineprint">
          Inspections stay on this device until you export and close them, so you
          can run several properties in a day and upload when you have signal.
          Closing one keeps this record but removes its photos from the phone.
        </p>
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-primary ss-btn-big" onClick={onNew}>
          <Plus size={20} strokeWidth={2.6} /> New inspection
        </button>
      </div>

      {target && (
        <div className="ss-modal-back" onClick={() => setConfirmId(null)}>
          <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ss-modal-icon"><AlertTriangle size={22} /></div>
            <div className="ss-modal-title">Discard {target.address}?</div>
            <p>
              Its {target.photos} photo{target.photos === 1 ? "" : "s"} and notes will be
              deleted from this device. Anything already exported or uploaded is unaffected.
            </p>
            <button className="ss-btn ss-btn-danger"
              onClick={() => { onDiscard(target.id); setConfirmId(null); }}>
              <Trash2 size={16} /> Delete inspection
            </button>
            <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }} onClick={() => setConfirmId(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      <TabBar active="cases" onChange={onTab} />
    </div>
  );
}

export function relativeDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
