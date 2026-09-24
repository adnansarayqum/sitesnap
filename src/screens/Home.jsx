import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Camera, ChevronRight, CloudUpload, Home as HomeIcon, Plus, Search, Smartphone, Trash2, X,
} from "lucide-react";
import {
  loadInspection, loadPhoto,
} from "../storage.js";
import { openIssues } from "../evidence.js";
import { AppHeader, BottomNavigation, Button, EmptyState, InlineAlert, InspectionCard, Modal, ProgressRing, StatusPill, StickyActionBar } from "../ui/index.js";

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

// What the index summary doesn't carry but the hero wants: the next room
// still to photograph and the open issue count. Read from the case record
// itself (no photos loaded — just the JSON).
async function caseDetail(id) {
  const data = await loadInspection(id);
  if (!data) return null;
  const rooms = data.rooms || [];
  const next = rooms.find((r) => !(r.photoIds || []).length);
  return {
    nextRoom: next ? next.name : null,
    issues: rooms.reduce((n, r) => n + openIssues(r).length, 0),
    firstPhotoId: rooms.flatMap((r) => r.photoIds || [])[0] || null,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function HomeScreen({ index, archive, onNew, onOpen, onContinue, onTab, needsCloud }) {
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const active = open[0] || null;
  const others = open.slice(1, 5);
  const [detail, setDetail] = useState(null);
  const [thumbs, setThumbs] = useState({}); // case id -> first photo's thumbnail

  useEffect(() => {
    if (!active) { setDetail(null); return; }
    let cancelled = false;
    caseDetail(active.id).then((d) => { if (!cancelled) setDetail(d); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active && active.id, active && active.updatedAt]);

  const othersKey = others.map((c) => `${c.id}:${c.photos}`).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = {};
      for (const c of others) {
        if (!c.photos) continue;
        const d = await caseDetail(c.id).catch(() => null);
        const p = d && d.firstPhotoId ? await loadPhoto(d.firstPhotoId).catch(() => null) : null;
        if (p) out[c.id] = p.thumb || p.dataUrl;
      }
      if (!cancelled) setThumbs(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey]);

  // Counted from cases on this device, the same source the Cases tab treats
  // as the record for "here". A closed case's photos are gone from the phone,
  // so "not exported" only looks at open ones.
  const closed = archive || [];
  const totalCases = index.length + closed.length;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const thisMonth = [...index, ...closed].filter((c) => (c.startedAt || 0) >= monthStart.getTime()).length;
  const awaitingExport = index.filter((c) => c.photos > 0 && !(c.lastExport || (c.lastUpload && c.lastUpload.confirmed))).length;

  const status = active ? caseStatus(active) : null;
  const walking = active && !active.completedAt;

  return (
    <div className="ss-col">
      <div className="ss-scroll">
        <div className="ss-eyebrow-sm">Stonebridge Surveyors</div>
        <h1 className="ss-h1">{timeGreeting()}, Shah</h1>

        {!active && (
          <>
            <p className="ss-lede">Ready for your next inspection?</p>
            <Button variant="primary" size="big" onClick={onNew}>
              <Plus size={20} strokeWidth={2.6} /> New inspection
            </Button>
          </>
        )}

        {/* the one case in hand, and the one thing to do with it */}
        {active && (
          <div className="ss-home-hero">
            <div className="ss-home-hero-top">
              <div className="ss-home-hero-text">
                <span className="ss-home-hero-eyebrow">{status.label} · Case {active.caseNo || "—"}</span>
                <span className="ss-case-hero-title">{active.address}</span>
                <span className="ss-case-hero-sub">{active.postcode ? `${active.postcode} · ` : ""}updated {relativeDay(active.updatedAt)}</span>
              </div>
              {active.rooms > 0 && <ProgressRing tone="dark" done={active.doneRooms || 0} total={active.rooms} />}
            </div>
            <div className="ss-home-hero-chips">
              <span>{plural(active.photos || 0, "photo")}</span>
              {detail && detail.issues > 0 && <span>{plural(detail.issues, "issue")}</span>}
              {walking && detail && detail.nextRoom && <span>Next: {detail.nextRoom}</span>}
            </div>
            {walking ? (
              <>
                <Button variant="go" size="big" onClick={() => onContinue(active.id)}>
                  {active.photos ? "Continue walkthrough" : "Start walkthrough"} <ArrowRight size={18} strokeWidth={2.4} />
                </Button>
                <button className="ss-home-hero-open" onClick={() => onOpen(active.id)}>
                  Open case file <ChevronRight size={15} />
                </button>
              </>
            ) : (
              <Button variant="go" size="big" onClick={() => onOpen(active.id)}>
                Open case file <ArrowRight size={18} strokeWidth={2.4} />
              </Button>
            )}
          </div>
        )}

        {needsCloud && <CloudStatusRow onTab={onTab} />}

        {totalCases > 0 && (
          <div className="ss-home-tiles">
            <button className={`ss-home-tile${awaitingExport ? " warn" : ""}`} onClick={() => onTab("cases")}>
              <b>{awaitingExport}</b><span>Not exported yet</span>
            </button>
            <div className="ss-home-tile">
              <b>{thisMonth}</b><span>This month</span>
            </div>
          </div>
        )}

        {active && (
          <Button variant="outline" size="big" style={{ marginTop: 12 }} onClick={onNew}>
            <Plus size={18} strokeWidth={2.6} /> New inspection
          </Button>
        )}

        {others.length > 0 && (
          <>
            <div className="ss-home-section">
              <span>Other cases</span>
              <button className="ss-link" onClick={() => onTab("cases")}>See all</button>
            </div>
            <div className="ss-home-rows">
              {others.map((c) => {
                const st = caseStatus(c);
                return (
                  <button key={c.id} className="ss-home-row" onClick={() => onOpen(c.id)}>
                    <span className="ss-home-row-thumb">{thumbs[c.id] ? <img src={thumbs[c.id]} alt="" /> : <HomeIcon size={20} />}</span>
                    <span className="ss-home-row-main">
                      <b>{c.address}</b>
                      <span>Case {c.caseNo || "—"} · {relativeDay(c.updatedAt)} · {c.rooms ? `${c.doneRooms || 0} of ${c.rooms} rooms` : plural(c.photos || 0, "photo")}</span>
                    </span>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </button>
                );
              })}
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

export function CasesScreen({ index, archive, durable, onNew, onOpen, onDiscard, onDiscardArchived, onTab }) {
  const [confirm, setConfirm] = useState(null); // { id, kind: "open" | "archived" }
  const [q, setQ] = useState("");
  const open = [...index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const done = archive || [];
  const target = confirm && (confirm.kind === "archived" ? done.find((a) => a.id === confirm.id) : open.find((i) => i.id === confirm.id));
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
              status={caseStatus(i)} onClick={() => onOpen(i.id)} onDelete={() => setConfirm({ id: i.id, kind: "open" })} />
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

        {doneShown.length > 0 && (
          <>
            <div className="ss-section-label" style={{ marginTop: 22 }}>Completed</div>
            <div className="ss-list">
              {doneShown.slice(0, 25).map((a) => (
                <InspectionCard key={a.id}
                  address={a.address} caseNo={a.caseNo} reference={a.ref || undefined}
                  date={`closed ${relativeDay(a.closedAt)}`} photos={a.photos}
                  status={archiveStatus(a)} onDelete={() => setConfirm({ id: a.id, kind: "archived" })} />
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
        <Modal onClose={() => setConfirm(null)} icon={<AlertTriangle size={22} />} title={<>Discard {target.address}?</>}>
            <p>
              {confirm.kind === "archived"
                ? "This removes the closed record from this phone. Its photos are already gone, and anything already exported or uploaded elsewhere is unaffected."
                : <>Its {target.photos} photo{target.photos === 1 ? "" : "s"} and notes will be
                  deleted from this device. Anything already exported or uploaded is unaffected.</>}
            </p>
            <Button variant="danger"
              onClick={() => { (confirm.kind === "archived" ? onDiscardArchived : onDiscard)(target.id); setConfirm(null); }}>
              <Trash2 size={16} /> Delete inspection
            </Button>
            <Button variant="ghost" style={{ marginTop: 8 }} onClick={() => setConfirm(null)}>
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
