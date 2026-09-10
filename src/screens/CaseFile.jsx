import { useState } from "react";
import { useRef } from "react";
import {
  Camera, Check, Image as ImageIcon, Pencil, Plus, StickyNote, CloudUpload, CloudOff, Loader2, AlertTriangle, Share2, Trash2, User,
} from "lucide-react";
import { ReorderableList, TopBar } from "../components/shared.jsx";
import { Coach } from "../components/Hints.jsx";
import { pad } from "../lib/util.js";
import { FinishScreen } from "./Finish.jsx";
import { FindingsTab } from "./Findings.jsx";
import { coverage, migrateFindings } from "../findings.js";
import { ClipboardCheck, Sparkles } from "lucide-react";
import { relativeDay } from "./Home.jsx";

/* ---------------- board (overview) ---------------- */

// Each tab's content already returns a <ss-scroll>+<ss-footer> pair meant to
// fill the space below the tab strip — this wrapper is what used to be
// implicit via .ss-col, kept explicit so switching tabs remounts a fresh
// element and replays the entrance animation.
const TAB_STYLE = { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 };

// The screen for an opened property. One shared header (address, case
// number, rename) plus a tab strip — Overview / Rooms / Findings / Export —
// standing in for what used to be four separate full-screen pushes. Walk and
// Evidence (the live camera and a room's photos) still push on top of this,
// same as before; only the finished-case wizard collapsed into tabs.
export function CaseFileScreen({
  inspection, sync, filing, onFiled, rooms, photoCache, totalPhotos, doneRooms,
  caseTab, onCaseTab, onExit, onReorder, onAddRoom, onRename, onOpenRoom, onWalk,
  filesForRoom, filesForUpload, fullPhoto, audioCache,
  onUploadResult, onExportResult, onFindings, onTranscripts, onRoom, me, syncNow, onTrack, onActivity, onSaveAll, onDone,
  idPhoto, onIdPhoto, onRemoveIdPhoto, onShareIdPhoto,
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState({ address: "", postcode: "" });

  const tabs = [
    ["overview", "Overview"],
    ["rooms", "Rooms"],
    ["findings", "Findings"],
    ["export", "Export"],
  ];

  return (
    <div className="ss-col">
      <TopBar
        title={inspection.address}
        eyebrow={inspection.caseNo ? `Case No. ${inspection.caseNo}` : (inspection.postcode || "Inspection in progress")}
        onBack={() => onExit()}
        right={
          <button className="ss-link" title="Edit the address or postcode" onClick={() => {
            setDraft({ address: inspection.address, postcode: inspection.postcode || "" });
            setRenaming(true);
          }}>
            <Pencil size={13} /> Edit
          </button>
        }
      />

      {renaming && (
        <div className="ss-modal-back" onClick={() => setRenaming(false)}>
          <div className="ss-modal ss-modal-left" onClick={(e) => e.stopPropagation()}>
            <div className="ss-modal-title">Property details</div>
            <input className="ss-input" autoFocus placeholder="Address"
              value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            <input className="ss-input" style={{ marginTop: 8 }} placeholder="Postcode"
              value={draft.postcode} onChange={(e) => setDraft({ ...draft, postcode: e.target.value.toUpperCase() })} />
            <p className="ss-fineprint" style={{ margin: "10px 2px 14px" }}>
              Photos already uploaded keep the old folder name — rename before
              uploading, or move that folder in OneDrive afterwards.
            </p>
            <button className="ss-btn ss-btn-primary" disabled={!draft.address.trim()}
              title={!draft.address.trim() ? "Address can't be empty" : undefined}
              onClick={() => { onRename({ address: draft.address.trim(), postcode: draft.postcode.trim() }); setRenaming(false); }}>
              Save
            </button>
            <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }} onClick={() => setRenaming(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="ss-case-tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={`ss-case-tab ${caseTab === key ? "on" : ""}`} onClick={() => onCaseTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {caseTab === "overview" && (
        <div className="ss-screen-in" style={TAB_STYLE}>
          <OverviewTab inspection={inspection} sync={sync} rooms={rooms} totalPhotos={totalPhotos} doneRooms={doneRooms} onWalk={onWalk}
            idPhoto={idPhoto} onIdPhoto={onIdPhoto} onRemoveIdPhoto={onRemoveIdPhoto} onShareIdPhoto={onShareIdPhoto} onCaseTab={onCaseTab} />
        </div>
      )}
      {caseTab === "rooms" && (
        <div className="ss-screen-in" style={TAB_STYLE}>
          <RoomsTab
            rooms={rooms} photoCache={photoCache} doneRooms={doneRooms} totalPhotos={totalPhotos}
            onReorder={onReorder} onAddRoom={onAddRoom} onOpenRoom={onOpenRoom} onWalk={onWalk}
          />
        </div>
      )}
      {caseTab === "findings" && (
        <div className="ss-screen-in" style={TAB_STYLE}>
          <FindingsTab inspection={inspection} rooms={rooms} photoCache={photoCache} fullPhoto={fullPhoto} audioCache={audioCache}
            onFindings={onFindings} onTranscripts={onTranscripts} onRoom={onRoom} me={me} syncNow={syncNow} onTrack={onTrack} onActivity={onActivity} onOpenRoom={onOpenRoom} />
        </div>
      )}
      {caseTab === "export" && (
        <div className="ss-screen-in" style={TAB_STYLE}>
          <FinishScreen filing={filing} onFiled={onFiled}
            inspection={inspection} rooms={rooms} photoCache={photoCache} totalPhotos={totalPhotos}
            filesForRoom={filesForRoom} filesForUpload={filesForUpload} fullPhoto={fullPhoto} audioCache={audioCache}
            onUploadResult={onUploadResult} onExportResult={onExportResult} onFindings={onFindings}
            onSaveAll={onSaveAll} onDone={onDone}
          />
        </div>
      )}
    </div>
  );
}

// The payoff card: once the walkthrough is finished, what the structured
// capture has already done for the surveyor, and the one next step.
export function InspectionSummary({ inspection, rooms, totalPhotos, onReview }) {
  const cov = coverage(rooms, migrateFindings(inspection.findings), inspection.transcripts || {});
  const issues = cov.flatMap((c) => c.issues);
  const ready = issues.filter((x) => x.issue.confirmedBySurveyor && x.eligibility.eligible && (!x.finding || x.finding.status === "approved" || x.finding.gate && x.finding.gate.status === "review_ready")).length;
  const needEvidence = issues.filter((x) => x.issue.confirmedBySurveyor && !x.eligibility.eligible).length;
  const unconfirmed = issues.filter((x) => !x.issue.confirmedBySurveyor).length;
  const loose = cov.filter((c) => c.loose.photoIds.length || c.loose.memoIds.length).length;
  const failedMemos = issues.reduce((n, x) => n + x.failedMemos.length, 0);
  const memos = rooms.reduce((n, r) => n + (r.memos || []).length, 0);
  const readings = rooms.reduce((n, r) => n + (r.readings || []).length, 0);
  const approved = issues.filter((x) => x.finding && x.finding.status === "approved").length;
  const drafted = issues.filter((x) => x.finding && !["rejected", "superseded"].includes(x.finding.status)).length;
  const visited = rooms.filter((r) => r.photoIds.length).length;
  return (
    <div className="ss-summary-card">
      <div className="ss-summary-head"><ClipboardCheck size={18} /><div><b>Inspection complete</b><span>{inspection.completedAt ? new Date(inspection.completedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span></div></div>
      <div className="ss-summary-stats">
        <div><b>{visited}</b><span>of {rooms.length} rooms</span></div>
        <div><b>{issues.length}</b><span>issue{issues.length === 1 ? "" : "s"}</span></div>
        <div><b>{totalPhotos}</b><span>photo{totalPhotos === 1 ? "" : "s"} organised</span></div>
        <div><b>{memos}</b><span>voice note{memos === 1 ? "" : "s"}</span></div>
        {readings > 0 && <div><b>{readings}</b><span>reading{readings === 1 ? "" : "s"}</span></div>}
      </div>
      <ul className="ss-summary-lines">
        {drafted > 0 && <li className="ok">✓ {drafted} finding{drafted === 1 ? "" : "s"} drafted{approved ? ` · ${approved} approved` : ""}</li>}
        {ready > 0 && drafted < ready && <li className="ok">✓ {ready - drafted} issue{ready - drafted === 1 ? "" : "s"} ready to draft</li>}
        {needEvidence > 0 && <li className="warn">⚠ {needEvidence} issue{needEvidence === 1 ? "" : "s"} need{needEvidence === 1 ? "s" : ""} a note, voice note or reading before drafting</li>}
        {unconfirmed > 0 && <li className="warn">⚠ {unconfirmed} suggested issue{unconfirmed === 1 ? "" : "s"} to confirm</li>}
        {loose > 0 && <li className="warn">⚠ Evidence in {loose} room{loose === 1 ? "" : "s"} not yet linked to an issue</li>}
        {failedMemos > 0 && <li className="warn">⚠ {failedMemos} voice note{failedMemos === 1 ? "" : "s"} not transcribed</li>}
        {!issues.length && !loose && <li className="warn">No issues raised — open a room and raise one, or organise its photos</li>}
      </ul>
      <button className="ss-btn ss-btn-primary ss-btn-big" onClick={onReview}><Sparkles size={18} /> {drafted ? "Review findings" : "Draft findings"}</button>
    </div>
  );
}

export function OverviewTab({ inspection, sync, rooms, totalPhotos, doneRooms, onWalk, idPhoto, onIdPhoto, onRemoveIdPhoto, onShareIdPhoto, onCaseTab }) {
  const idInput = useRef(null);
  const firstEmpty = Math.max(0, rooms.findIndex((r) => r.photoIds.length === 0));
  const rank = { Poor: 3, Fair: 2, Good: 1 };
  const worst = rooms.reduce((w, r) => ((rank[r.condition] || 0) > (rank[w] || 0) ? r.condition : w), null);
  const details = [
    ["Reference", inspection.ref],
    ["Client", inspection.client],
    ["Occupier", inspection.occupier],
    ["Solicitor", inspection.solicitor],
  ].filter(([, v]) => v);

  return (
    <>
      <div className="ss-scroll">
        {inspection.completedAt ? (
          <InspectionSummary inspection={inspection} rooms={rooms} totalPhotos={totalPhotos} onReview={() => onCaseTab && onCaseTab("findings")} />
        ) : (
          <Coach id="casefile" title="Your case file">
            <b>Overview</b>, <b>Rooms</b>, <b>Findings</b> and <b>Export</b> are the four tabs above. <b>Start walkthrough</b> opens the camera and takes you room by room.
          </Coach>
        )}
        <div className="ss-case-cover">
          <div className="ss-case-cover-head">
            <span className="ss-stamp">Case No. {inspection.caseNo || "—"}</span>
            {worst && <span className={`ss-cbadge ${worst.toLowerCase()}`}>{worst}</span>}
          </div>
          <div className="ss-case-kv-grid">
            {details.map(([label, value]) => (
              <div key={label}>
                <div className="ss-kv-label">{label}</div>
                <div className="ss-kv-value">{value}</div>
              </div>
            ))}
            <div>
              <div className="ss-kv-label">Started</div>
              <div className="ss-kv-value">{relativeDay(inspection.startedAt)}</div>
            </div>
            <div>
              <div className="ss-kv-label">Areas</div>
              <div className="ss-kv-value">{doneRooms} of {rooms.length} covered</div>
            </div>
          </div>
        </div>

        {sync && (
          <div className={`ss-sync ss-sync-${sync.status}`} role="status">
            {sync.status === "synced" && <><CloudUpload size={12} /> In the firm register · updated {relativeDay(sync.at)}</>}
            {sync.status === "syncing" && <><Loader2 size={12} className="ss-spin" /> Updating the firm register…</>}
            {sync.status === "offline" && <><CloudOff size={12} /> Offline — the register catches up when you're back on signal</>}
            {sync.status === "error" && <><AlertTriangle size={12} /> Register not updated: {sync.error}</>}
            {sync.status === "idle" && <><CloudUpload size={12} /> Not in the firm register yet</>}
          </div>
        )}

        {/* The surveyor's ID selfie for the file: its own slot, so it never
            lands in a room folder and never needs pulling out of the batch
            by hand. Files to _Inspection/ on upload and export. */}
        <input ref={idInput} type="file" accept="image/*" capture="user" className="ss-hidden"
          onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) onIdPhoto(f); }} />
        <div className="ss-idphoto">
          {idPhoto && (idPhoto.thumb || idPhoto.dataUrl) ? <img src={idPhoto.thumb || idPhoto.dataUrl} alt="" /> : <div className="ph"><User size={22} /></div>}
          <div className="ss-idphoto-main">
            <b>ID photo</b>
            <span>{idPhoto ? "Filed separately from room photos." : "Kept out of the room folders."}</span>
          </div>
          <div className="ss-idphoto-actions">
            {idPhoto && onShareIdPhoto && <button onClick={onShareIdPhoto} aria-label="Share ID photo" title="Share or email the ID photo"><Share2 size={16} /></button>}
            {idPhoto && <button onClick={onRemoveIdPhoto} aria-label="Remove ID photo" title="Remove"><Trash2 size={16} /></button>}
            <button onClick={() => idInput.current && idInput.current.click()} aria-label={idPhoto ? "Retake ID photo" : "Take ID photo"} title={idPhoto ? "Retake" : "Take"}><Camera size={16} /></button>
          </div>
        </div>

        <div className="ss-section-label" style={{ marginTop: 20 }}>Case activity</div>
        {(inspection.activity && inspection.activity.length) ? (
          <div className="ss-activity">
            {[...inspection.activity].reverse().slice(0, 15).map((a, i) => (
              <div key={i} className="ss-activity-row">
                <span className="ss-activity-time">
                  {new Date(a.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="ss-activity-dot" />
                <span className="ss-activity-text">{a.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="ss-empty-note">No activity yet.</p>
        )}

        <div style={{ height: 12 }} />
      </div>
      <div className="ss-footer">
        <button className="ss-btn ss-btn-live ss-btn-big" onClick={() => onWalk(firstEmpty)}>
          <Camera size={20} strokeWidth={2.4} />
          {totalPhotos === 0 ? "Start walkthrough" : "Continue walkthrough"}
        </button>
      </div>
    </>
  );
}

export function RoomsTab({ rooms, photoCache, doneRooms, totalPhotos, onReorder, onAddRoom, onOpenRoom, onWalk }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const firstEmpty = Math.max(0, rooms.findIndex((r) => r.photoIds.length === 0));
  const pct = rooms.length ? Math.round((doneRooms / rooms.length) * 100) : 0;

  return (
    <>
      <div className="ss-progress-wrap">
        <div className="ss-progress"><div style={{ width: `${pct}%` }} /></div>
        <span>{doneRooms}/{rooms.length} rooms covered</span>
      </div>

      <div className="ss-scroll">
        <ReorderableList
          items={rooms}
          onReorder={onReorder}
          onRowTap={(room) => onOpenRoom(room.id)}
          renderRow={(room, index) => {
            const lastId = room.photoIds[room.photoIds.length - 1];
            const thumb = lastId ? photoCache[lastId] : null;
            return (
              <>
                <div className="ss-row-main">
                  <span className="ss-index">{pad(index + 1)}</span>
                  <span className="ss-row-name">{room.name}</span>
                  {room.condition && <span className={`ss-cdot ${room.condition.toLowerCase()}`} title={room.condition} />}
                  {room.note ? <StickyNote size={12} className="ss-note-flag" /> : null}
                </div>
                <span className="ss-row-right">
                  {thumb ? (
                    <img src={thumb.thumb || thumb.dataUrl} alt="" className="ss-thumb" />
                  ) : (
                    <span className="ss-thumb ss-thumb-empty"><ImageIcon size={13} /></span>
                  )}
                  <span className={`ss-pill ${room.photoIds.length ? "done" : ""}`}>
                    {room.photoIds.length ? room.photoIds.length : "—"}
                  </span>
                </span>
              </>
            );
          }}
        />

        {adding ? (
          <div className="ss-inline-add">
            <input className="ss-input" autoFocus placeholder="Room name" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onAddRoom(name.trim()); setName(""); setAdding(false); } }} />
            <button className="ss-btn ss-btn-primary ss-btn-sq"
              onClick={() => { if (name.trim()) onAddRoom(name.trim()); setName(""); setAdding(false); }}>
              <Check size={18} />
            </button>
          </div>
        ) : (
          <button className="ss-dashed" onClick={() => setAdding(true)}><Plus size={15} /> Add room</button>
        )}

        {totalPhotos === 0 && (
          <div className="ss-tip info">
            <ImageIcon size={14} />
            <span>Drag the grip on the left to reorder rooms — that order sets the numbering used in the report and cloud folders.</span>
          </div>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-live ss-btn-big" onClick={() => onWalk(firstEmpty)}>
          <Camera size={20} strokeWidth={2.4} />
          {totalPhotos === 0 ? "Start walkthrough" : "Continue walkthrough"}
        </button>
      </div>
    </>
  );
}
