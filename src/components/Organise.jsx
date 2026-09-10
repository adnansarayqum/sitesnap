import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Loader2, Mic, Plus, Sparkles, Trash2, X } from "lucide-react";
import { addIssue, addSuggestedIssues, adoptLegacyIssue, confirmIssue, deleteIssue, linkEvidence, openIssues, unassigned, unlinkEvidence, transcriptUsable } from "../evidence.js";
import { aiConfig, aiPhotoCopy, suggestClusters, transcribeMemo, AI_MAX_PHOTOS } from "../ai.js";
import { transcriptFromServer, failedTranscript } from "../evidence.js";
import { withOfflineRetry } from "../aiRetry.js";
import { IssuePicker, linkSourceLabel } from "./Evidence.jsx";

// Organising a room's evidence into issues after the fact — for cases shot
// before issues existed, or a room shot in a hurry. Three routes, none
// automatic: treat all of it as one issue, ask for suggestions (which land
// unconfirmed and have to be accepted), or move items by hand. Nothing here
// invents a photo↔voice-note relationship the surveyor didn't make.
export function OrganiseSheet({ caseId, room, photoCache, fullPhoto, audioCache, transcripts, onTranscripts, onRoom, onActivity, onClose }) {
  const [busy, setBusy] = useState(null); // "suggest" | null
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null); // { id, kind }
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [oneTitle, setOneTitle] = useState(room.name);
  const loose = unassigned(room);
  const issues = openIssues(room);
  const suggested = issues.filter((i) => !i.confirmedBySurveyor);

  function pick(id, kind, choice, newTitle) {
    onRoom((r) => {
      if (choice === null) return unlinkEvidence(r, id);
      if (choice === "new") { const { room: r2, issue } = addIssue(r, newTitle); return linkEvidence(r2, issue.id, { id, kind, source: "human_created" }); }
      return linkEvidence(r, choice, { id, kind, source: "human_created" });
    });
    setPicking(null);
  }

  async function suggest() {
    setBusy("suggest"); setError(null);
    try {
      const cfg = await aiConfig();
      if (!cfg.enabled) throw new Error("Suggestions need ANTHROPIC_API_KEY on the server.");
      const photos = [];
      for (const pid of loose.photoIds.slice(0, AI_MAX_PHOTOS)) {
        const p = await fullPhoto(pid);
        if (p && p.dataUrl) photos.push({ id: pid, no: p.no || null, caption: p.caption || "", captionSource: p.captionAi ? "ai" : "human", dataUrl: await aiPhotoCopy(p.dataUrl), takenAt: p.takenAt || null, linkSource: "legacy_unassigned" });
      }
      // loose voice notes are transcribed first so the suggestion can read them
      let words = { ...transcripts };
      const memos = [];
      for (const mid of loose.memoIds) {
        const m = (room.memos || []).find((x) => x.id === mid) || { id: mid };
        if (!transcriptUsable(words[mid]) && cfg.transcription && audioCache.current[mid]) {
          try { words[mid] = transcriptFromServer(mid, await withOfflineRetry(() => transcribeMemo(caseId, room.id, m, audioCache.current[mid]))); }
          catch (e) { words[mid] = failedTranscript(e.code === "transcription_off" ? "unavailable" : e.message); }
        }
        const t = words[mid];
        memos.push({ id: mid, secs: m.secs || null, linkSource: "legacy_unassigned", transcript: t ? { text: t.text || "", status: t.status, version: t.version || 1, provider: t.provider || null } : null });
      }
      if (onTranscripts) onTranscripts(words);
      const res = await suggestClusters(caseId, room, photos, memos);
      onRoom((r) => addSuggestedIssues(r, res.issues.map((s) => ({ ...s, model: res.model }))).room);
      onActivity && onActivity(`${room.name}: ${res.issues.length} issue${res.issues.length === 1 ? "" : "s"} suggested for review${res.uncertain.length ? ` — ${res.uncertain.length} item${res.uncertain.length === 1 ? "" : "s"} left uncertain` : ""}`);
      if (!res.issues.length) setError("No confident grouping was suggested — organise by hand below.");
    } catch (e) { setError(e.message || "Couldn't get suggestions."); }
    finally { setBusy(null); }
  }

  const thumb = (id) => { const p = photoCache[id]; return p ? <img src={p.thumb || p.dataUrl} alt="" /> : <span className="ss-thumb ss-thumb-empty" />; };

  return createPortal((
    <div className="ss-modal-back" onClick={onClose}>
      <div className="ss-modal ss-modal-left ss-sheet ss-organise" onClick={(e) => e.stopPropagation()}>
        <div className="ss-sheet-head">
          <div className="ss-modal-title" style={{ margin: 0 }}>Organise {room.name}</div>
          <button className="ss-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="ss-sheet-body">
          <p className="ss-fineprint" style={{ marginTop: 0 }}>A finding is drafted per issue, from the evidence linked to it. Nothing is linked for you without your say-so.</p>

          {issues.length > 0 && (
            <>
              <div className="ss-finding-label">Issues</div>
              {issues.map((i) => (
                <div key={i.id} className={`ss-org-issue ${i.confirmedBySurveyor ? "" : "suggested"}`}>
                  <div className="ss-org-issue-head">
                    <b>{i.title}</b>
                    <span className="ss-org-count">{(i.evidence || []).filter((e) => e.kind === "photo").length} photo{(i.evidence || []).filter((e) => e.kind === "photo").length === 1 ? "" : "s"}{(i.evidence || []).some((e) => e.kind === "memo") ? ` · ${(i.evidence || []).filter((e) => e.kind === "memo").length} voice` : ""}</span>
                  </div>
                  {!i.confirmedBySurveyor && (
                    <div className="ss-org-suggest">
                      <Sparkles size={12} /> AI-suggested{i.suggestion && i.suggestion.confidence ? ` · ${i.suggestion.confidence} confidence` : ""}{i.suggestion && i.suggestion.rationale ? ` — ${i.suggestion.rationale}` : ""}
                      <div className="ss-finding-actions" style={{ marginTop: 6 }}>
                        <button className="ss-btn ss-btn-primary" onClick={() => { onRoom((r) => confirmIssue(r, i.id)); onActivity && onActivity(`${room.name}: confirmed issue “${i.title}”`); }}><Check size={14} /> Confirm</button>
                        <button className="ss-btn ss-btn-ghost" onClick={() => onRoom((r) => deleteIssue(r, i.id))}><Trash2 size={14} /> Discard</button>
                      </div>
                    </div>
                  )}
                  <div className="ss-org-grid">
                    {(i.evidence || []).map((e) => (
                      <button key={e.id} className={`ss-org-item ${e.kind}`} onClick={() => setPicking({ id: e.id, kind: e.kind })} title={`${linkSourceLabel(e.source)} — tap to move`}>
                        {e.kind === "photo" ? thumb(e.id) : e.kind === "memo" ? <span className="ss-org-memo"><Mic size={13} /> Voice note {((room.memos || []).findIndex((m) => m.id === e.id) + 1) || "?"}</span> : <span className="ss-org-memo">Reading</span>}
                        {!["capture_session", "human_created", "human_confirmed_ai"].includes(e.source) && <span className="ss-org-unconf"><Sparkles size={9} /></span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {(loose.photoIds.length > 0 || loose.memoIds.length > 0 || loose.readingIds.length > 0) && (
            <>
              <div className="ss-finding-label">Not linked to an issue</div>
              <div className="ss-org-grid">
                {loose.photoIds.map((id) => <button key={id} className="ss-org-item photo" onClick={() => setPicking({ id, kind: "photo" })}>{thumb(id)}{photoCache[id] && photoCache[id].no ? <span className="ss-cell-no">{photoCache[id].no}</span> : null}</button>)}
                {loose.memoIds.map((id) => <button key={id} className="ss-org-item memo" onClick={() => setPicking({ id, kind: "memo" })}><span className="ss-org-memo"><Mic size={13} /> Voice note {(room.memos || []).findIndex((m) => m.id === id) + 1}{transcripts[id] && transcripts[id].status === "failed" ? " · not transcribed" : ""}</span></button>)}
                {loose.readingIds.map((id) => { const r = (room.readings || []).find((x) => x.id === id); return <button key={id} className="ss-org-item memo" onClick={() => setPicking({ id, kind: "reading" })}><span className="ss-org-memo">{r ? r.text : "Reading"}</span></button>; })}
              </div>
              <p className="ss-fineprint">Tap an item to say which issue it belongs to.</p>
              {issues.length === 0 && (
                <div className="ss-org-one">
                  <input className="ss-input" value={oneTitle} onChange={(e) => setOneTitle(e.target.value)} placeholder="Issue title" />
                  <button className="ss-btn ss-btn-primary" disabled={!oneTitle.trim()} onClick={() => { onRoom((r) => adoptLegacyIssue(r, oneTitle.trim()).room); onActivity && onActivity(`${room.name}: all evidence treated as one issue “${oneTitle.trim()}”`); }}>
                    <Check size={15} /> Treat all of it as one issue
                  </button>
                </div>
              )}
              <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} disabled={!!busy} onClick={suggest}>
                {busy === "suggest" ? <Loader2 size={16} className="ss-spin" /> : <Sparkles size={16} />} {busy === "suggest" ? "Reading the evidence…" : "Suggest issues (AI)"}
              </button>
              {suggested.length > 0 && <p className="ss-fineprint"><Sparkles size={11} /> Suggestions are marked and unconfirmed until you confirm them; they cannot be drafted from before that.</p>}
            </>
          )}

          {adding ? (
            <div className="ss-inline-add">
              <input className="ss-input" autoFocus placeholder="Issue, e.g. Damaged flooring" value={title} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) { onRoom((r) => addIssue(r, title.trim()).room); setTitle(""); setAdding(false); } }} />
              <button className="ss-btn ss-btn-primary ss-btn-sq" disabled={!title.trim()} onClick={() => { onRoom((r) => addIssue(r, title.trim()).room); setTitle(""); setAdding(false); }}><Check size={18} /></button>
            </div>
          ) : (
            <button className="ss-dashed" onClick={() => setAdding(true)}><Plus size={15} /> New issue</button>
          )}
          {error && <div className="ss-gaps"><AlertTriangle size={13} /> {error}</div>}
        </div>
      </div>
      {picking && <IssuePicker room={room} evidenceId={picking.id} kind={picking.kind} onClose={() => setPicking(null)} onPick={(choice, newTitle) => pick(picking.id, picking.kind, choice, newTitle)} />}
    </div>
  ), document.querySelector(".ss-root") || document.body);
}
