import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Check, Gauge, Mic, Pencil, Plus, Sparkles, StickyNote, X } from "lucide-react";
import { correctTranscript, issueFor, openIssues } from "../evidence.js";

// Evidence references as the surveyor sees them: a chip that names the
// source ("Photo 12", "Voice note 2") and opens it — the photograph, the
// transcript (with the recording where the browser can play it, and the
// surveyor's correction beside the machine's original), the reading, the
// note. A paragraph is never asked to be trusted without its sources.

export function sourceLabel(id) {
  const m = /^([A-Z]+)-(\d+)$/.exec(id || "");
  if (!m) return id || "";
  const n = m[2];
  switch (m[1]) {
    case "PHOTO": return `Photo ${n}`;
    case "CAPTION": return `Caption ${n}`;
    case "MEMO": return `Voice note ${n}`;
    case "READING": return `Reading ${n}`;
    case "NOTE": return "Room note";
    case "DESC": return "Issue description";
    case "HYP": return "Your suspected cause";
    case "OBS": return `Observation ${Number(n)}`;
    case "STMT": return `Statement ${Number(n)}`;
    case "MEAS": return `Measurement ${Number(n)}`;
    default: return id;
  }
}
const iconFor = (id) => (/^PHOTO|^CAPTION/.test(id) ? <Camera size={11} /> : /^MEMO/.test(id) ? <Mic size={11} /> : /^READING|^MEAS/.test(id) ? <Gauge size={11} /> : <StickyNote size={11} />);

export function EvidenceChip({ id, onOpen, tone }) {
  return (
    <button type="button" className={`ss-evchip ${tone || ""}`} onClick={() => onOpen && onOpen(id)} title={id}>
      {iconFor(id)} {sourceLabel(id)}
    </button>
  );
}
export function EvidenceChips({ ids, onOpen, tone, empty }) {
  const list = [...new Set(ids || [])];
  if (!list.length) return empty ? <span className="ss-evchip-empty">{empty}</span> : null;
  return <span className="ss-evchips">{list.map((id) => <EvidenceChip key={id} id={id} onOpen={onOpen} tone={tone} />)}</span>;
}

// Resolves an evidence id against the finding's source map and the room, and
// shows it. `finding.evidence.sources[id]` carries the photo/memo/reading id.
export function EvidenceSheet({ id, finding, room, photoCache, fullPhoto, audioCache, transcripts, onTranscripts, onClose, me }) {
  const src = (finding && finding.evidence && finding.evidence.sources && finding.evidence.sources[id]) || null;
  const obs = finding && finding.evidence ? [...(finding.evidence.observations || []), ...(finding.evidence.statements || []), ...(finding.evidence.measurements || [])].find((o) => o.id === id) : null;
  const [full, setFull] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const photoId = src && src.photoId;
  const memoId = src && src.memoId;
  const rec = memoId ? transcripts[memoId] : null;
  useEffect(() => {
    let stale = false;
    if (photoId && fullPhoto) fullPhoto(photoId).then((p) => { if (!stale && p && p.dataUrl) setFull(p.dataUrl); });
    if (memoId && audioCache && audioCache.current && audioCache.current[memoId]) {
      const u = URL.createObjectURL(audioCache.current[memoId]);
      setAudioUrl(u);
      return () => { stale = true; URL.revokeObjectURL(u); };
    }
    return () => { stale = true; };
  }, [photoId, memoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const photo = photoId ? photoCache[photoId] : null;
  const memoIdx = memoId && room ? (room.memos || []).findIndex((m) => m.id === memoId) : -1;
  const reading = src && src.readingId && room ? (room.readings || []).find((r) => r.id === src.readingId) : null;
  const issue = room && (photoId || memoId) ? issueFor(room, photoId || memoId) : null;
  const link = issue ? (issue.evidence || []).find((e) => e.id === (photoId || memoId)) : null;

  function saveCorrection() {
    if (!rec) return;
    const next = correctTranscript(rec, draft, me && me.user ? me.user.id : null);
    onTranscripts && onTranscripts((t) => ({ ...t, [memoId]: next }));
    setEditing(false);
  }

  return createPortal((
    <div className="ss-modal-back" onClick={onClose}>
      <div className="ss-modal ss-modal-left ss-sheet ss-evsheet" onClick={(e) => e.stopPropagation()}>
        <div className="ss-sheet-head">
          <div className="ss-modal-title" style={{ margin: 0 }}>{sourceLabel(id)}</div>
          <button className="ss-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="ss-sheet-body">
          {photoId && (
            <>
              {(full || (photo && (photo.thumb || photo.dataUrl))) ? <img className="ss-evsheet-img" src={full || photo.thumb || photo.dataUrl} alt="" /> : <p className="ss-fineprint">This photograph is no longer in the case.</p>}
              {photo && <p className="ss-fineprint">Exhibit {photo.no}{photo.caption ? ` · ${photo.captionAi ? "AI-suggested caption" : "caption"}: “${photo.caption}”` : ""}{photo.takenAt ? ` · taken ${new Date(photo.takenAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</p>}
              {src.hash && <p className="ss-fineprint mono">image hash {src.hash}</p>}
            </>
          )}
          {memoId && (
            <>
              {audioUrl ? <audio controls src={audioUrl} style={{ width: "100%" }} /> : <p className="ss-fineprint">The recording isn't on this device{memoIdx >= 0 ? "" : " — and the voice note is no longer in the case"}.</p>}
              <div className="ss-finding-label">Transcript</div>
              {!rec && <p className="ss-fineprint">Not transcribed.</p>}
              {rec && !editing && (
                <>
                  <p className="ss-transcript">{rec.text || <em>{rec.status === "failed" ? "Transcription failed." : rec.status === "unavailable" ? "Transcription unavailable on this server." : "Empty."}</em>}</p>
                  <p className="ss-fineprint">
                    {rec.status === "corrected" ? <>Corrected by the surveyor{rec.correctedAt ? ` on ${new Date(rec.correctedAt).toLocaleDateString("en-GB")}` : ""} · v{rec.version}. </> : null}
                    {rec.provider ? <>Machine transcript: {rec.provider}{rec.model ? ` (${rec.model})` : ""}{rec.at ? `, ${new Date(rec.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}.</> : rec.status === "complete" ? "Origin of this transcript is unknown (pre-2.0)." : null}
                  </p>
                  {rec.status === "corrected" && <details className="ss-details"><summary>Original machine transcript</summary><p className="ss-transcript">{rec.original}</p></details>}
                  {onTranscripts && rec.original && <button className="ss-link" onClick={() => { setDraft(rec.text || rec.original); setEditing(true); }}><Pencil size={13} /> Correct transcript</button>}
                </>
              )}
              {rec && editing && (
                <div className="ss-edit-form">
                  <textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <p className="ss-fineprint">The machine's original is kept. Findings drafted from the old wording will ask to be regenerated.</p>
                  <div className="ss-finding-actions">
                    <button className="ss-btn ss-btn-primary" onClick={saveCorrection}><Check size={15} /> Save correction</button>
                    <button className="ss-btn ss-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
          {reading && <p className="ss-finding-text">{reading.text}{reading.value ? ` — ${reading.value}${reading.unit ? ` ${reading.unit}` : ""}` : ""}</p>}
          {src && src.type === "note" && room && <><p className="ss-finding-text">{room.note}</p><p className="ss-fineprint">Source: {noteSourceLabel(room.noteSource)}</p></>}
          {src && src.type === "issue_description" && issueDescription(finding, room)}
          {src && src.type === "hypothesis" && <p className="ss-finding-text">{finding.surveyor_hypothesis}</p>}
          {src && src.type === "caption" && <><p className="ss-finding-text">“{src.text}”</p><p className="ss-fineprint">{src.by === "ai" ? "AI-suggested caption — not a human observation" : "Surveyor's caption"} on exhibit {src.no}</p></>}
          {obs && <><p className="ss-finding-text">{obs.statement}</p><p className="ss-fineprint">{obs.certainty ? `Certainty ${obs.certainty} · ` : ""}rests on: </p><EvidenceChips ids={obs.source_ids} /></>}
          {!src && !obs && <p className="ss-fineprint">This reference isn't in the finding's evidence record.</p>}
          {issue && (
            <p className="ss-fineprint">In issue <b>{issue.title}</b>{link ? ` · link ${linkSourceLabel(link.source)}` : ""}.</p>
          )}
        </div>
      </div>
    </div>
  ), document.querySelector(".ss-root") || document.body);
}
function issueDescription(finding, room) {
  const issue = room && (room.issues || []).find((i) => i.id === finding.issueId);
  return issue ? <p className="ss-finding-text">{issue.description}</p> : null;
}

export function noteSourceLabel(s) {
  return { human_typed: "typed by the surveyor", human_adopted_ai: "AI suggestion adopted by the surveyor", ai_generated: "AI-generated — not adopted", voice_transcript: "voice transcript", legacy_unknown: "unknown origin (pre-2.0 note)" }[s] || "unknown origin";
}
export function linkSourceLabel(s) {
  return { capture_session: "made while shooting", human_created: "made by the surveyor", ai_suggested: "AI-suggested, not confirmed", human_confirmed_ai: "AI-suggested, confirmed by the surveyor", legacy_unassigned: "unassigned (pre-2.0 evidence)" }[s] || s || "unknown";
}

// Move an item to an issue, to the room in general, or to a new issue.
export function IssuePicker({ room, evidenceId, kind, onPick, onClose }) {
  const current = issueFor(room, evidenceId);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  return createPortal((
    <div className="ss-modal-back" onClick={onClose}>
      <div className="ss-modal ss-modal-left ss-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ss-sheet-head">
          <div className="ss-modal-title" style={{ margin: 0 }}>Which issue is this {kind === "memo" ? "voice note" : kind === "reading" ? "reading" : "photo"} about?</div>
          <button className="ss-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="ss-sheet-body ss-picker">
          {openIssues(room).map((i) => (
            <button key={i.id} className={`ss-picker-row ${current && current.id === i.id ? "on" : ""}`} onClick={() => onPick(i.id)}>
              <span>{i.title}{!i.confirmedBySurveyor && <Sparkles size={11} className="ss-inline-ic" title="AI-suggested issue" />}</span>
              {current && current.id === i.id && <Check size={15} />}
            </button>
          ))}
          <button className={`ss-picker-row ${!current ? "on" : ""}`} onClick={() => onPick(null)}>
            <span>General — about the room, not one issue</span>
            {!current && <Check size={15} />}
          </button>
          {adding ? (
            <div className="ss-inline-add">
              <input className="ss-input" autoFocus placeholder="Issue, e.g. Ceiling mould" value={title} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) onPick("new", title.trim()); }} />
              <button className="ss-btn ss-btn-primary ss-btn-sq" disabled={!title.trim()} onClick={() => onPick("new", title.trim())}><Check size={18} /></button>
            </div>
          ) : (
            <button className="ss-dashed" onClick={() => setAdding(true)}><Plus size={15} /> New issue</button>
          )}
        </div>
      </div>
    </div>
  ), document.querySelector(".ss-root") || document.body);
}

// the small tag on a photo cell or a voice-note row
export function IssueTag({ room, evidenceId, onClick, dark }) {
  const issue = issueFor(room, evidenceId);
  const link = issue ? (issue.evidence || []).find((e) => e.id === evidenceId) : null;
  const unconfirmed = link && !["capture_session", "human_created", "human_confirmed_ai"].includes(link.source);
  return (
    <button type="button" className={`ss-issuetag ${issue ? "" : "none"} ${unconfirmed ? "unconfirmed" : ""} ${dark ? "dark" : ""}`} onClick={(e) => { e.stopPropagation(); onClick && onClick(); }} title={issue ? `${issue.title} — ${linkSourceLabel(link.source)}. Tap to move.` : "Not linked to an issue — tap to choose one"}>
      {unconfirmed && <Sparkles size={10} />}{issue ? issue.title : "General"}
    </button>
  );
}
