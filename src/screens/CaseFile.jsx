import { useEffect, useState } from "react";
import { useRef } from "react";
import {
  Camera, Check, Image as ImageIcon, Loader2, Pencil, Plus, ScanLine, Share2, Trash2, User,
} from "lucide-react";
import { ReorderableList } from "../components/shared.jsx";
import { Coach } from "../components/Hints.jsx";
import { openIssues } from "../evidence.js";
import { FinishScreen } from "./Finish.jsx";
import { FindingsTab } from "./Findings.jsx";
import { coverage, migrateFindings } from "../findings.js";
import { ClipboardCheck, Sparkles } from "lucide-react";
import { relativeDay } from "./Home.jsx";
import { AppHeader, Button, EmptyState, InlineAlert, Modal, ProgressBar, RoomCard, SegmentedControl, StickyActionBar, SyncIndicator } from "../ui/index.js";
import { aiConfig, aiPhotoCopy, extractIntake } from "../ai.js";
import { readFileAsDataUrl } from "../lib/image.js";

// Report type is the MLA/TLB legal-report taxonomy — distinct from the
// general `type` field (Standard/Inventory/Other) Setup already collects.
const REPORT_TYPES = ["Single Inspection", "Staggered Joint Inspection", "Joint Inspection", "Single Joint Inspection"];
const AGENCIES = ["MLA", "TLB", "Other"];
const YES_NO = ["No", "Yes"];
const CONDITIONS = ["Good", "Fair", "Poor"];

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
  inspection, filing, saveStatus, onFiled, rooms, photoCache, totalPhotos, doneRooms,
  caseTab, onCaseTab, onExit, onReorder, onAddRoom, onRename, onOpenRoom, onWalk,
  filesForRoom, filesForUpload, fullPhoto, audioCache,
  onUploadResult, onExportResult, onFindings, onTranscripts, onRoom, me, onTrack, onActivity, onSaveAll, onDone,
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
      <AppHeader
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
        <Modal onClose={() => setRenaming(false)} left title="Property details">
            <input className="ss-input" autoFocus placeholder="Address"
              value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            <input className="ss-input" style={{ marginTop: 8 }} placeholder="Postcode"
              value={draft.postcode} onChange={(e) => setDraft({ ...draft, postcode: e.target.value.toUpperCase() })} />
            <p className="ss-fineprint" style={{ margin: "10px 2px 14px" }}>
              Photos already uploaded keep the old folder name — rename before
              uploading, or move that folder in OneDrive afterwards.
            </p>
            <Button variant="primary" disabled={!draft.address.trim()}
              title={!draft.address.trim() ? "Address can't be empty" : undefined}
              onClick={() => { onRename({ address: draft.address.trim(), postcode: draft.postcode.trim() }); setRenaming(false); }}>
              Save
            </Button>
            <Button variant="ghost" style={{ marginTop: 8 }} onClick={() => setRenaming(false)}>Cancel</Button>
        </Modal>
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
          <OverviewTab inspection={inspection} filing={filing} saveStatus={saveStatus} rooms={rooms} totalPhotos={totalPhotos} doneRooms={doneRooms} onWalk={onWalk}
            idPhoto={idPhoto} onIdPhoto={onIdPhoto} onRemoveIdPhoto={onRemoveIdPhoto} onShareIdPhoto={onShareIdPhoto} onCaseTab={onCaseTab} onUpdateDetails={onRename} />
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
            onFindings={onFindings} onTranscripts={onTranscripts} onRoom={onRoom} me={me} onTrack={onTrack} onActivity={onActivity} onOpenRoom={onOpenRoom} />
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
      <Button variant="primary" size="big" onClick={onReview}><Sparkles size={18} /> {drafted ? "Review findings" : "Draft findings"}</Button>
    </div>
  );
}

// Housing-disrepair letters this recognises: a letter of claim, a letter of
// instruction, or a medico-legal agency's instruction letter to the expert.
const MAX_IMPORT_FILES = 8;
const MAX_IMPORT_PDF_BYTES = 12 * 1024 * 1024;

export function OverviewTab({ inspection, filing, saveStatus, rooms, totalPhotos, doneRooms, onWalk, idPhoto, onIdPhoto, onRemoveIdPhoto, onShareIdPhoto, onCaseTab, onUpdateDetails }) {
  const idInput = useRef(null);
  const importInput = useRef(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [aiCfg, setAiCfg] = useState({ enabled: false });
  useEffect(() => { aiConfig().then(setAiCfg); }, []);
  const firstEmpty = Math.max(0, rooms.findIndex((r) => r.photoIds.length === 0));
  const rank = { Poor: 3, Fair: 2, Good: 1 };
  const worst = rooms.reduce((w, r) => ((rank[r.condition] || 0) > (rank[w] || 0) ? r.condition : w), null);
  const details = [
    ["Reference", inspection.ref],
    ["Claimant", inspection.claimant],
    ["Defendant", inspection.defendant],
    ["Client", inspection.client],
    ["Occupier", inspection.occupier],
    ["Solicitor", inspection.solicitor],
    ["Instructed by", inspection.instructedBy],
    ["Agency", inspection.agency],
    ["Report type", inspection.reportType],
    ["Landlord surveyor", inspection.landlordSurveyorName],
    ["Date of instruction", inspection.dateOfInstruction],
    ["Weather", inspection.weather],
    ["Temperature", inspection.temperature ? `${inspection.temperature}°C` : ""],
    ["Time to complete works", inspection.timeToCompleteWorks],
    ["Decanting", inspection.decanting],
    ["Condition internally", inspection.conditionInternally],
    ["Condition externally", inspection.conditionExternally],
  ].filter(([, v]) => v);

  // One or more photographed pages, or a native PDF, of a letter of claim
  // or instruction -> a best-effort read of the case-detail fields it
  // states. Never written straight into the case — it opens the same form
  // as manual editing, pre-filled, for the surveyor to check and save.
  async function handleImportFiles(e) {
    const files = Array.from(e.target.files || []).slice(0, MAX_IMPORT_FILES);
    e.target.value = "";
    if (!files.length) return;
    setImportError(null);
    setImporting(true);
    let skipReason = null; // a per-file problem, kept locally — state set moments ago in this same call isn't visible yet
    try {
      const documents = [];
      for (const f of files) {
        if (f.type === "application/pdf") {
          if (f.size > MAX_IMPORT_PDF_BYTES) { skipReason = skipReason || `${f.name} is too big — PDFs must be under 12MB.`; continue; }
          documents.push({ dataUrl: await readFileAsDataUrl(f) });
        } else if (f.type.startsWith("image/")) {
          documents.push({ dataUrl: await aiPhotoCopy(await readFileAsDataUrl(f)) });
        }
      }
      if (!documents.length) {
        setImportError(skipReason || "Choose a photo or a PDF of the letter.");
        setImporting(false);
        return;
      }
      const r = await extractIntake(inspection.id, documents);
      if (!r.recognised) { setImportError("Couldn't find case details in that — try a clearer photo of the letter, or the original PDF."); setImporting(false); return; }
      setImportResult(r);
    } catch (err) {
      setImportError((err && err.message) || "Couldn't read that letter — try again.");
    }
    setImporting(false);
  }

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
          {inspection.propertyDescription && (
            <p className="ss-fineprint" style={{ margin: "10px 2px 0", lineHeight: 1.5 }}>{inspection.propertyDescription}</p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10 }}>
            <button className="ss-link" onClick={() => setEditingDetails(true)}>
              <Pencil size={13} /> {details.length ? "Edit case details" : "Add case details"}
            </button>
            {aiCfg.enabled && (
              <button className="ss-link" disabled={importing} onClick={() => importInput.current && importInput.current.click()}>
                {importing ? <Loader2 size={13} className="ss-spin" /> : <ScanLine size={13} />} {importing ? "Reading letter…" : "Import from letter"}
              </button>
            )}
          </div>
          {importError && <p className="ss-fineprint" style={{ color: "var(--red)", margin: "6px 2px 0" }}>{importError}</p>}
        </div>

        <input ref={importInput} type="file" accept="image/*,application/pdf" multiple className="ss-hidden" onChange={handleImportFiles} />

        {editingDetails && (
          <CaseDetailsModal inspection={inspection} onClose={() => setEditingDetails(false)}
            onSave={(patch) => { onUpdateDetails && onUpdateDetails(patch); setEditingDetails(false); }} />
        )}

        {importResult && (
          <CaseDetailsModal inspection={inspection} overrides={importResult}
            importNote="Imported from your letter — check every field before saving."
            onClose={() => setImportResult(null)}
            onSave={(patch) => { onUpdateDetails && onUpdateDetails(patch); setImportResult(null); }} />
        )}

        <SyncIndicator variant="line" saveStatus={saveStatus} filing={filing} />

        {/* The surveyor's ID selfie for the file: its own slot, so it never
            lands in a room folder and never needs pulling out of the batch
            by hand. Files to Inspection/ on upload and export; Share covers
            getting a copy off the phone. */}
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
          <EmptyState note>No activity yet.</EmptyState>
        )}

        <div style={{ height: 12 }} />
      </div>
      <StickyActionBar>
        <Button variant="primary" size="big" onClick={() => onWalk(firstEmpty)}>
          <Camera size={20} strokeWidth={2.4} />
          {totalPhotos === 0 ? "Start walkthrough" : "Continue walkthrough"}
        </Button>
      </StickyActionBar>
    </>
  );
}

// The metadata an expert witness report actually needs beyond address and
// rooms — claimant/defendant, who instructed, report type, site conditions
// on the day. Filled progressively from whichever source has it first (the
// letter of instruction, the letter of claim, or the surveyor on site), not
// all at once at Setup — Setup stays fast.
// `overrides` (optional): a just-extracted read of a letter (see
// extractIntake) whose non-empty fields seed the form instead of the
// case's own saved values — used only for the "Import from letter" review
// step, never applied without the surveyor seeing and saving it here.
function CaseDetailsModal({ inspection, onClose, onSave, overrides, importNote }) {
  const pick = (k) => (overrides && overrides[k]) || inspection[k] || "";
  const [d, setD] = useState({
    ref: (overrides && overrides.caseReference) || inspection.ref || "", address: pick("address"), postcode: pick("postcode"),
    claimant: pick("claimant"), defendant: pick("defendant"),
    instructedBy: pick("instructedBy"), agency: pick("agency"),
    reportType: pick("reportType"), landlordSurveyorName: pick("landlordSurveyorName"),
    dateOfInstruction: pick("dateOfInstruction"), weather: inspection.weather || "",
    temperature: inspection.temperature || "", propertyDescription: inspection.propertyDescription || "",
    timeToCompleteWorks: inspection.timeToCompleteWorks || "", decanting: inspection.decanting || "",
    conditionInternally: inspection.conditionInternally || "", conditionExternally: inspection.conditionExternally || "",
  });
  const set = (k) => (v) => setD((prev) => ({ ...prev, [k]: v }));
  return (
    <Modal onClose={onClose} left title="Case details" className="ss-modal-form">
      {importNote && <InlineAlert tone="info" icon={<ScanLine size={14} />}>{importNote}</InlineAlert>}
      <div className="ss-field-label">Case reference</div>
      <input className="ss-input" value={d.ref} onChange={(e) => set("ref")(e.target.value)} placeholder="e.g. SJS 207938.001" />
      <div className="ss-field-label" style={{ marginTop: 10 }}>Property address</div>
      <input className="ss-input" value={d.address} onChange={(e) => set("address")(e.target.value)} placeholder="e.g. 23 High Street" />
      <input className="ss-input" style={{ marginTop: 8 }} value={d.postcode} onChange={(e) => set("postcode")(e.target.value.toUpperCase())} placeholder="Postcode" />
      <p className="ss-fineprint" style={{ margin: "4px 2px 0" }}>Photos already uploaded keep the old folder name if you change this.</p>

      <div className="ss-field-label" style={{ marginTop: 14 }}>Claimant</div>
      <input className="ss-input" value={d.claimant} onChange={(e) => set("claimant")(e.target.value)} placeholder="e.g. Miss J Smith (Claimant)" />
      <div className="ss-field-label" style={{ marginTop: 10 }}>Defendant</div>
      <input className="ss-input" value={d.defendant} onChange={(e) => set("defendant")(e.target.value)} placeholder="e.g. London Borough of Southwark" />
      <div className="ss-field-label" style={{ marginTop: 10 }}>Instructed by</div>
      <input className="ss-input" value={d.instructedBy} onChange={(e) => set("instructedBy")(e.target.value)} placeholder="e.g. SJS Legal Limited" />

      <div className="ss-field-label" style={{ marginTop: 14 }}>Agency</div>
      <SegmentedControl className="ss-seg-row" itemClass="ss-seg-item" options={AGENCIES} value={d.agency} onChange={set("agency")} />
      <div className="ss-field-label" style={{ marginTop: 10 }}>Report type</div>
      <select className="ss-input" value={d.reportType} onChange={(e) => set("reportType")(e.target.value)}>
        <option value="">Not set</option>
        {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input className="ss-input" style={{ marginTop: 8 }} value={d.landlordSurveyorName} onChange={(e) => set("landlordSurveyorName")(e.target.value)} placeholder="Landlord surveyor name (if any)" />
      <input className="ss-input" style={{ marginTop: 8 }} type="date" value={d.dateOfInstruction} onChange={(e) => set("dateOfInstruction")(e.target.value)} />
      <p className="ss-fineprint" style={{ margin: "4px 2px 0" }}>Date of instruction</p>

      <div className="ss-field-label" style={{ marginTop: 14 }}>Site conditions</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input className="ss-input" value={d.weather} onChange={(e) => set("weather")(e.target.value)} placeholder="Weather" style={{ flex: 1 }} />
        <input className="ss-input" type="number" value={d.temperature} onChange={(e) => set("temperature")(e.target.value)} placeholder="°C" style={{ width: 90 }} />
      </div>
      <textarea className="ss-input" style={{ marginTop: 8, minHeight: 90 }} value={d.propertyDescription}
        onChange={(e) => set("propertyDescription")(e.target.value)}
        placeholder="Property description — construction, roof, approximate age, layout" />
      <input className="ss-input" style={{ marginTop: 8 }} value={d.timeToCompleteWorks} onChange={(e) => set("timeToCompleteWorks")(e.target.value)} placeholder="Time to complete works, e.g. Circa 2 weeks" />

      <div className="ss-field-label" style={{ marginTop: 10 }}>Decanting required?</div>
      <SegmentedControl className="ss-seg-row" itemClass="ss-seg-item" options={YES_NO} value={d.decanting} onChange={set("decanting")} />

      <div className="ss-field-label" style={{ marginTop: 10 }}>Condition internally</div>
      <SegmentedControl className="ss-seg-row" itemClass="ss-seg-item" options={CONDITIONS} value={d.conditionInternally} onChange={set("conditionInternally")} />
      <div className="ss-field-label" style={{ marginTop: 10 }}>Condition externally</div>
      <SegmentedControl className="ss-seg-row" itemClass="ss-seg-item" options={CONDITIONS} value={d.conditionExternally} onChange={set("conditionExternally")} />

      <Button variant="primary" style={{ marginTop: 16 }} onClick={() => onSave({
        ...d, ref: d.ref.trim(), address: d.address.trim() || inspection.address, postcode: d.postcode.trim(),
        temperature: d.temperature === "" ? "" : Number(d.temperature),
      })}>Save</Button>
      <Button variant="ghost" style={{ marginTop: 8 }} onClick={onClose}>Cancel</Button>
    </Modal>
  );
}

export function RoomsTab({ rooms, photoCache, doneRooms, totalPhotos, onReorder, onAddRoom, onOpenRoom, onWalk }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const firstEmpty = Math.max(0, rooms.findIndex((r) => r.photoIds.length === 0));
  const pct = rooms.length ? Math.round((doneRooms / rooms.length) * 100) : 0;
  const completeCount = rooms.filter((r) => r.complete).length;

  return (
    <>
      <div className="ss-progress-wrap">
        <ProgressBar value={pct} label="Rooms covered" />
        <span>{doneRooms} of {rooms.length} rooms covered · {pct}%{completeCount ? ` · ${completeCount} complete` : ""}</span>
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
              <RoomCard index={index} name={room.name} photos={room.photoIds.length} issues={openIssues(room).length}
                condition={room.condition} complete={room.complete} hasNote={!!room.note}
                thumb={thumb ? (thumb.thumb || thumb.dataUrl) : null} />
            );
          }}
        />

        {adding ? (
          <div className="ss-inline-add">
            <input className="ss-input" autoFocus placeholder="Room name" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onAddRoom(name.trim()); setName(""); setAdding(false); } }} />
            <Button variant="primary" size="sq"
              onClick={() => { if (name.trim()) onAddRoom(name.trim()); setName(""); setAdding(false); }}>
              <Check size={18} />
            </Button>
          </div>
        ) : (
          <button className="ss-dashed" onClick={() => setAdding(true)}><Plus size={15} /> Add room</button>
        )}

        {totalPhotos === 0 && (
          <InlineAlert tone="info" icon={<ImageIcon size={14} />}>Drag the grip on the left to reorder rooms — that order sets the numbering used in the report and cloud folders.</InlineAlert>
        )}
        <div style={{ height: 12 }} />
      </div>

      <StickyActionBar>
        <Button variant="primary" size="big" onClick={() => onWalk(firstEmpty)}>
          <Camera size={20} strokeWidth={2.4} />
          {totalPhotos === 0 ? "Start walkthrough" : "Continue walkthrough"}
        </Button>
      </StickyActionBar>
    </>
  );
}
