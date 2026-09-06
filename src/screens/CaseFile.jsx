import { useState } from "react";
import {
  Camera, Check, Image as ImageIcon, Pencil, Plus, StickyNote, CloudUpload, CloudOff, Loader2, AlertTriangle,
} from "lucide-react";
import { ReorderableList, TopBar } from "../components/shared.jsx";
import { pad } from "../lib/util.js";
import { FindingsTab, FinishScreen } from "./Finish.jsx";
import { relativeDay } from "./Home.jsx";

/* ---------------- board (overview) ---------------- */

// The screen for an opened property. One shared header (address, case
// number, rename) plus a tab strip — Overview / Rooms / Findings / Export —
// standing in for what used to be four separate full-screen pushes. Walk and
// Evidence (the live camera and a room's photos) still push on top of this,
// same as before; only the finished-case wizard collapsed into tabs.
export function CaseFileScreen({
  inspection, sync, rooms, photoCache, totalPhotos, doneRooms,
  caseTab, onCaseTab, onExit, onReorder, onAddRoom, onRename, onOpenRoom, onWalk,
  filesForRoom, filesForUpload, fullPhoto, audioCache,
  onUploadResult, onExportResult, onFindings, onSaveAll, onDone, onSettings,
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
        <OverviewTab inspection={inspection} sync={sync} rooms={rooms} totalPhotos={totalPhotos} doneRooms={doneRooms} onWalk={onWalk} />
      )}
      {caseTab === "rooms" && (
        <RoomsTab
          rooms={rooms} photoCache={photoCache} doneRooms={doneRooms} totalPhotos={totalPhotos}
          onReorder={onReorder} onAddRoom={onAddRoom} onOpenRoom={onOpenRoom} onWalk={onWalk}
        />
      )}
      {caseTab === "findings" && (
        <FindingsTab draft={inspection.draftFindings} onChange={onFindings} />
      )}
      {caseTab === "export" && (
        <FinishScreen
          inspection={inspection} rooms={rooms} photoCache={photoCache} totalPhotos={totalPhotos}
          filesForRoom={filesForRoom} filesForUpload={filesForUpload} fullPhoto={fullPhoto} audioCache={audioCache}
          onUploadResult={onUploadResult} onExportResult={onExportResult} onFindings={onFindings}
          onSaveAll={onSaveAll} onDone={onDone} onSettings={onSettings}
        />
      )}
    </div>
  );
}

export function OverviewTab({ inspection, sync, rooms, totalPhotos, doneRooms, onWalk }) {
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
