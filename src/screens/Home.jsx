import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Camera, CloudUpload, Plus, Search, Smartphone, Trash2, X,
} from "lucide-react";
import {
  loadInspection, loadPhoto,
} from "../storage.js";
import { AppHeader, BottomNavigation, Button, EmptyState, InlineAlert, InspectionCard, Modal, StickyActionBar } from "../ui/index.js";

/* ---------------- home ---------------- */

// Until photos have somewhere to go, a slim status line says so — every
// visit, not a one-time billboard, because "not now" on day one shouldn't
// mean never being reminded again.
function CloudStatusRow({ onTab }) {
  return (
    <button className="ss-cloud-status" onClick={() => onTab("settings")}>
      <CloudUpload size={14} />
      <span>Photos file to <b>nowhere yet</b></span>
      <span className="ss-cloud-status-cta">Set up <ArrowRight size={13} /></span>
    </button>
  );
}

function timeGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// An open case's status, derived from fields already on its index summary
// — no state of its own. `completedAt` is set once the surveyor taps
// Finish inspection at the end of the walkthrough; "exported" means the
// cloud upload was confirmed filed, or the surveyor generated a ZIP/PDF.
function caseStatus(c) {
  if (!c.photos) return { tone: undefined, label: "Draft" };
  const exported = !!c.lastExport || !!(c.lastUpload && c.lastUpload.confirmed);
  if (!c.completedAt) return { tone: "active", label: "In progress" };
  return exported ? { tone: "done", label: "Complete" } : { tone: "warn", label: "Awaiting export" };
}

// A closed case's own photos are gone from the phone, but its upload/export
// record travelled with it into the archive — same four-state idea as
// caseStatus(), just answering "did it get out" instead of "is it done".
function archiveStatus(a) {
  if (a.lastUpload && a.lastUpload.confirmed) return { tone: "done", label: "Filed in the cloud" };
  if (a.lastUpload) return { tone: "warn", label: "Sent, not confirmed" };
  if (a.lastExport) return { tone: "warn", label: "Exported only" };
  return { tone: "bad", label: "Never uploaded" };
}

export function HomeScreen({ index, archive, onNew, onOpen, onTab, orgName, needsCloud, me }) {
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const active = open[0] || null;
  const others = open.slice(1, 5);
  const [thumbs, setThumbs] = useState([]);
  const firstName = me && me.user && me.user.name ? me.user.name.trim().split(/\s+/)[0] : null;

  useEffect(() => {
    if (!active) { setThumbs([]); return; }
    let cancelled = false;
    (async () => {
      const data = await loadInspection(active.id);
      if (cancelled || !data) return;
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

  // Stats are computed from cases on this device — the same source the
  // Cases tab already treats as the record for "here". A closed case's
  // photos are gone from the phone, so "awaiting export" only ever looks
  // at open ones; "total" and "this month" count everything, open or not.
  const closed = archive || [];
  const totalCases = index.length + closed.length;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const thisMonth = [...index, ...closed].filter((c) => (c.startedAt || 0) >= monthStart.getTime()).length;
  const awaitingExport = index.filter((c) => c.photos > 0 && !(c.lastExport || (c.lastUpload && c.lastUpload.confirmed))).length;

  return (
    <div className="ss-col">
      <div className="ss-scroll">
        <div className="ss-eyebrow-sm">{orgName || "SiteSnap"}</div>
        <h1 className="ss-h1">{timeGreeting()}{firstName ? `, ${firstName}` : ""}</h1>
        <p className="ss-lede">Ready for your next inspection?</p>

        <Button variant="primary" size="big" onClick={onNew}>
          <Plus size={20} strokeWidth={2.6} /> New inspection
        </Button>

        {needsCloud && <CloudStatusRow onTab={onTab} />}

        {totalCases > 0 && (
          <div className="ss-stat-row">
            <div className="ss-stat-tile"><span className="ss-stat-value">{totalCases}</span><span className="ss-stat-label">Total cases</span></div>
            <div className="ss-stat-tile"><span className="ss-stat-value">{thisMonth}</span><span className="ss-stat-label">This month</span></div>
            <div className="ss-stat-tile"><span className="ss-stat-value">{awaitingExport}</span><span className="ss-stat-label">Awaiting export</span></div>
          </div>
        )}

        {active && (
          <>
            <div className="ss-section-label" style={{ marginTop: 24 }}>Continue where you left off</div>
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
              {active.rooms > 0 && (
                <div className="ss-case-hero-progress">
                  <div className="ss-progress"><div style={{ width: `${Math.round(((active.doneRooms || 0) / active.rooms) * 100)}%` }} /></div>
                  <span className="ss-case-hero-progress-label">{active.doneRooms || 0} of {active.rooms} rooms covered</span>
                </div>
              )}
              <div className="ss-case-hero-cta"><span>Resume case</span><ArrowRight size={15} /></div>
            </button>
          </>
        )}

        {others.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 24 }}>Recent inspections</div>
            <div className="ss-list">
              {others.map((c) => (
                <InspectionCard key={c.id}
                  address={c.address} caseNo={c.caseNo} date={relativeDay(c.updatedAt)}
                  photos={c.photos} rooms={c.rooms} doneRooms={c.doneRooms}
                  status={caseStatus(c)} onClick={() => onOpen(c.id)} />
              ))}
            </div>
          </>
        )}

        {totalCases === 0 && (
          <div style={{ marginTop: 24 }}>
            <EmptyState icon={<Camera size={22} />}>
              <p>Nothing here yet. Start your first inspection and it will appear here, ready to resume any time.</p>
            </EmptyState>
          </div>
        )}
        <div style={{ height: 16 }} />
      </div>

      <BottomNavigation active="home" onChange={onTab} />
    </div>
  );
}

export function CasesScreen({ index, archive, durable, onNew, onOpen, onDiscard, onTab, register, onOpenRemote }) {
  const [confirmId, setConfirmId] = useState(null);
  const [q, setQ] = useState("");
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const target = open.find((i) => i.id === confirmId);

  const done = archive || [];
  const needle = q.trim().toLowerCase();
  const matches = (i) => !needle || [i.address, i.ref, i.postcode].filter(Boolean).join(" ").toLowerCase().includes(needle);
  const openShown = open.filter(matches);
  const doneShown = done.filter(matches);
  // the firm's register (accounts mode): colleagues' cases, and this
  // person's own from another phone — anything not already on this one
  const here = new Set([...open.map((i) => i.id), ...done.map((a) => a.id)]);
  const remote = (register || []).filter((c) => !here.has(c.id));
  // a closed case's own photos are gone from this phone, but the register
  // kept its details and thumbnails — so it's still worth opening, as long
  // as it actually made it to the register (it may have closed offline)
  const inRegister = new Set((register || []).map((c) => c.id));
  const matchesRemote = (c) => !needle || [c.address, c.ref, c.postcode, c.created_by_name].filter(Boolean).join(" ").toLowerCase().includes(needle);
  const remoteOpen = remote.filter((c) => c.status === "open" && matchesRemote(c));
  const remoteClosed = remote.filter((c) => c.status === "closed" && matchesRemote(c));
  const remoteCard = (c, closed) => (
    <InspectionCard key={c.id}
      address={c.address} caseNo={c.case_no} reference={`by ${c.created_by_name || "a colleague"}`}
      date={relativeDay(new Date(c.updated_at).getTime())} photos={c.photos}
      status={closed ? { tone: "done", label: "Complete" } : { tone: "active", label: "In progress" }}
      onClick={() => onOpenRemote(c.id)} />
  );

  if (open.length === 0 && done.length === 0 && remote.length === 0) {
    return (
      <div className="ss-col">
        <div className="ss-home-top">
          <div>
            <div className="ss-eyebrow-sm">Register</div>
            <div className="ss-title-lg">All cases</div>
          </div>
        </div>
        <div className="ss-scroll">
          <EmptyState note>No cases yet. Start your first inspection below.</EmptyState>
        </div>
        <StickyActionBar>
          <Button variant="primary" size="big" onClick={onNew}>
            <Plus size={20} strokeWidth={2.6} /> New inspection
          </Button>
        </StickyActionBar>
        <BottomNavigation active="cases" onChange={onTab} />
      </div>
    );
  }

  return (
    <div className="ss-col">
      <AppHeader title="All cases" eyebrow="Register" right={<span className="ss-badge">{open.length}</span>} />

      <div className="ss-search-row">
        <Search size={15} className="ss-search-ic" />
        <input className="ss-search-input" placeholder="Search address, ref, postcode…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="ss-search-clear" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
      </div>

      <div className="ss-scroll">
        {needle && openShown.length === 0 && doneShown.length === 0 && (
          <EmptyState note>Nothing matches “{q.trim()}”.</EmptyState>
        )}
        <div className="ss-list">
          {openShown.map((i) => (
            <InspectionCard key={i.id}
              address={i.address} caseNo={i.caseNo} reference={i.ref || i.postcode || undefined}
              date={relativeDay(i.startedAt)} photos={i.photos} rooms={i.rooms} doneRooms={i.doneRooms}
              status={caseStatus(i)} onClick={() => onOpen(i.id)} onDelete={() => setConfirmId(i.id)} />
          ))}
        </div>
        {durable === false && (
          <InlineAlert icon={<Smartphone size={14} />}>
              Add SiteSnap to your home screen (Share → Add to Home Screen). It
              stops the browser clearing photos you haven't uploaded yet.
            </InlineAlert>
        )}
        {open.length === 0 && !needle && (
          <EmptyState note>Nothing in progress on this phone. Start a new inspection below.</EmptyState>
        )}

        {remoteOpen.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 22 }}>Elsewhere in the firm</div>
            <div className="ss-list">{remoteOpen.map((c) => remoteCard(c, false))}</div>
          </>
        )}

        {(doneShown.length > 0 || remoteClosed.length > 0) && (
          <>
            <div className="ss-section-label" style={{ marginTop: 22 }}>Completed</div>
            <div className="ss-list">
              {remoteClosed.slice(0, 50).map((c) => remoteCard(c, true))}
              {doneShown.slice(0, 25).map((a) => (
                <InspectionCard key={a.id}
                  address={a.address} caseNo={a.caseNo} reference={a.ref || undefined}
                  date={`closed ${relativeDay(a.closedAt)}`} photos={a.photos}
                  status={archiveStatus(a)}
                  disabled={!inRegister.has(a.id)}
                  title={inRegister.has(a.id) ? undefined : "This case closed before it could sync — its details didn't reach the register"}
                  onClick={() => onOpenRemote(a.id)} />
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

      <StickyActionBar>
        <Button variant="primary" size="big" onClick={onNew}>
          <Plus size={20} strokeWidth={2.6} /> New inspection
        </Button>
      </StickyActionBar>

      {target && (
        <Modal onClose={() => setConfirmId(null)} icon={<AlertTriangle size={22} />} title={<>Discard {target.address}?</>}>
            <p>
              Its {target.photos} photo{target.photos === 1 ? "" : "s"} and notes will be
              deleted from this device. Anything already exported or uploaded is unaffected.
            </p>
            <Button variant="danger"
              onClick={() => { onDiscard(target.id); setConfirmId(null); }}>
              <Trash2 size={16} /> Delete inspection
            </Button>
            <Button variant="ghost" style={{ marginTop: 8 }} onClick={() => setConfirmId(null)}>
              Keep it
            </Button>
        </Modal>
      )}
      <BottomNavigation active="cases" onChange={onTab} />
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
