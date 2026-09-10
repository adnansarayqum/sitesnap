import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, FolderTree, History, Loader2, Pencil, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, X,
} from "lucide-react";
import {
  aiConfig, transcribeMemo, draftIssue, issueRequest, reviewFinding, priceWithQuantities, newRequestId,
} from "../ai.js";
import {
  migrateFindings, mergeRun, transition, reconcile, coverage, effective, liveItems, approvalBlockers, needsAttention, flagLabel, flagSeverity,
} from "../findings.js";
import { issueFingerprint, issueMemoIds, issuePhotoIds, transcriptFromServer, failedTranscript, transcriptUsable, confirmIssue, deleteIssue, legacyIssueId } from "../evidence.js";
import { sortFlags } from "../../shared/findingRules.js";
import { withOfflineRetry } from "../aiRetry.js";
import { InfoTip } from "../components/Hints.jsx";
import { EvidenceChips, EvidenceSheet, linkSourceLabel } from "../components/Evidence.jsx";
import { OrganiseSheet } from "../components/Organise.jsx";
import { FeedbackButton } from "../components/Feedback.jsx";

// The Findings tab. Coverage first — every room, every issue, what was
// processed and what wasn't — then the findings themselves, each traceable
// to its sources, each under the state machine. Nothing here files or sends
// anything; approving only decides what reaches the report.
const SCOPE_LABEL = { localised: "Localised repair", whole_element: "Whole element", multiple_elements: "Several elements", investigation_first: "Investigate first" };
const STATUS_LABEL = { draft: "Draft", review_required: "Review required", edited: "Edited — not approved", approved: "Approved", rejected: "Rejected", superseded: "Superseded" };
const GATE_LABEL = { blocked: "Blocked", incomplete_evidence: "Evidence incomplete", review_ready: "Ready for review" };
const money = (n) => `£${Math.round(n).toLocaleString("en-GB")}`;
const sourceLabelShort = (id) => { const m = /^MEMO-(\d+)$/.exec(id); return m ? `Memo ${m[1]}` : id; };
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function FindingsTab({ inspection, rooms, photoCache, fullPhoto, audioCache, onFindings, onTranscripts, onRoom, onActivity, me, onOpenRoom, syncNow, onTrack }) {
  const track = onTrack || (() => {});
  const state = migrateFindings(inspection.findings);
  const transcripts = inspection.transcripts || {};
  const [cfg, setCfg] = useState(null);
  const [progress, setProgress] = useState(null); // { statuses: {issueId: queued|transcribing|analysing|waiting|done|failed|cancelled}, running, error }
  const [editing, setEditing] = useState(null);   // { id, defect, works }
  const [qty, setQty] = useState(null);           // { id, values: {rowId: n}, busy, error }
  const [sheet, setSheet] = useState(null);       // { id, finding, room }
  const [organising, setOrganising] = useState(null); // roomId
  const [open, setOpen] = useState({});           // { [`${kind}:${id}`]: bool } expanders
  const [notice, setNotice] = useState(null);
  const abortRef = useRef(null);
  useEffect(() => { aiConfig().then(setCfg); }, []);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  // the evidence may have moved under a finding since it was drafted — or the
  // reference pack may have changed under it; either puts it back in front
  // of the surveyor and keeps the approved version in its history
  useEffect(() => {
    if (!inspection.findings) return;
    const { state: next, changed } = reconcile(state, { rooms, photoCache, transcripts, refState: cfg && cfg.reference });
    if (changed.length) {
      onFindings(next);
      const stale = changed.filter((c) => c.reasons.length);
      if (stale.length && onActivity) onActivity(`${stale.length} finding${stale.length === 1 ? "" : "s"} need${stale.length === 1 ? "s" : ""} review — evidence changed since drafting`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, photoCache, transcripts, cfg, inspection.findings]);

  const cov = coverage(rooms, state, transcripts);
  const live = liveItems(state);
  const draftable = cov.flatMap((c) => c.issues.filter((x) => x.eligibility.eligible && x.issue.confirmedBySurveyor).map((x) => ({ ...x, room: c.room })));
  const needsDraft = draftable.filter((x) => !x.finding || x.finding.stale || ["rejected", "superseded"].includes(x.finding.status));
  const approved = live.filter((f) => f.status === "approved").length;
  const total = live.filter((f) => f.status !== "rejected").length;
  const attention = live.filter((f) => ["draft", "review_required", "edited"].includes(f.status) && (needsAttention(effective(f)) || f.gate && f.gate.status !== "review_ready")).length;
  const aiOff = cfg && !cfg.enabled;
  const roomOf = (f) => rooms.find((r) => r.id === f.roomId);
  const issueOf = (f) => { const r = roomOf(f); return r ? (r.issues || []).find((i) => i.id === f.issueId) : null; };
  const currentFp = (f) => { const r = roomOf(f); const i = issueOf(f); return r && i ? issueFingerprint(i, r, photoCache, transcripts) : null; };
  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(null), 5000); };

  function cancelDraft() { if (abortRef.current) abortRef.current.abort(); }

  async function draftIssues(targets, { force = [] } = {}) {
    if (progress && progress.running) return;
    if (!targets.length) return;
    // in a firm the register is the authority on what belongs to the case:
    // push the latest room/issue/photo state first so the server can check
    // the evidence against it (it refuses anything it doesn't know)
    if (syncNow) { try { await syncNow(); } catch { /* offline — the server will say so if it matters */ } }
    const controller = new AbortController();
    abortRef.current = controller;
    const statuses = {};
    targets.forEach((t) => { statuses[t.issue.id] = "queued"; });
    setProgress({ statuses, running: true, error: null });
    track("draft_requested", { case: inspection.id, count: targets.length, reused: force.length ? force : undefined });
    let working = state;
    let words = { ...transcripts };
    let drafted = 0, failed = 0, blocked = 0, cancelled = false;
    const set = (id, st) => setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [id]: st } }));
    for (const t of targets) {
      if (controller.signal.aborted) { cancelled = true; break; }
      const { room, issue } = t;
      const order = rooms.indexOf(room) + 1;
      try {
        // voice notes first; a note that can't be transcribed is recorded as
        // such, so the pipeline knows the evidence is incomplete
        const pending = issueMemoIds(issue).filter((mid) => !transcriptUsable(words[mid]) && audioCache.current[mid]);
        if (pending.length) {
          set(issue.id, "transcribing");
          for (const mid of pending) {
            const m = (room.memos || []).find((x) => x.id === mid) || { id: mid };
            if (!(cfg && cfg.transcription)) { words[mid] = failedTranscript("unavailable"); continue; }
            try {
              const rec = await withOfflineRetry(() => transcribeMemo(inspection.id, room.id, m, audioCache.current[mid], controller.signal), { isAlive: () => !controller.signal.aborted, onQueued: () => set(issue.id, "waiting") });
              words[mid] = transcriptFromServer(mid, rec);
            } catch (e) { if (e.name === "AbortError") throw e; words[mid] = failedTranscript(e.code === "transcription_off" ? "unavailable" : e.message); console.error("transcribe", e); }
          }
          onTranscripts(words);
        }
        set(issue.id, "analysing");
        // one request id per attempt: a retry after a dropped signal replays
        // the same request and gets the same answer, never a second finding
        const requestId = newRequestId();
        const snapshot = issueFingerprint(issue, room, photoCache, words);
        const body = await issueRequest({ inspection, room, issue, order, photoCache, transcripts: words, fullPhoto, requestId, snapshot, prior: working.runs[issue.id], force });
        const res = await withOfflineRetry(() => draftIssue(inspection.id, room.id, issue.id, body, controller.signal), { isAlive: () => !controller.signal.aborted, onQueued: () => set(issue.id, "waiting") });
        working = mergeRun(working, { issue, room }, res);
        onFindings(working);
        drafted += 1;
        track(res.run.reused && res.run.reused.length ? "finding_regenerated" : "finding_generated", { case: inspection.id, issue: issue.id, gate: res.finding.gate && res.finding.gate.status, agreement: res.finding.assessment && res.finding.assessment.agreement, flags: res.finding.review_flags, reused: res.run.reused });
        if (res.finding.gate && res.finding.gate.status !== "review_ready") blocked += 1;
        set(issue.id, "done");
      } catch (e) {
        if (e.name === "AbortError") { cancelled = true; set(issue.id, "cancelled"); break; }
        failed += 1;
        console.error("draft", e);
        setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [issue.id]: "failed" }, error: `${issue.title}: ${e.message}` }));
      }
    }
    abortRef.current = null;
    if (onActivity) onActivity(cancelled
      ? `Drafting cancelled — ${drafted} issue${drafted === 1 ? "" : "s"} drafted before stopping`
      : `Drafted ${drafted} issue${drafted === 1 ? "" : "s"}${blocked ? ` — ${blocked} held back by verification or missing evidence` : ""}${failed ? ` — ${failed} failed` : ""}`);
    setProgress((p) => p && ({ ...p, running: false, cancelled }));
  }

  // ---- review actions, under the state machine ---------------------------------------
  async function decide(f, status, extra = {}) {
    const fp = currentFp(f);
    const { state: next, error, blockers } = transition(state, f.id, status, { ...extra, currentFingerprint: fp, by: me && me.user ? me.user.id : null });
    if (error) { flash(blockers ? `Can't approve yet: ${error}` : error); return false; }
    onFindings(next);
    setEditing(null);
    const r = await reviewFinding(f.id, status, { reviewed: extra.reviewed, snapshot: f.evidenceFingerprint, reason: extra.reason });
    if (r && r.ok === false) {
      // the server knows better (another device changed the evidence, a
      // blocked gate on the register copy): put it back and say why
      onFindings(state);
      flash(`The register refused: ${r.message || r.error}`);
      return false;
    }
    if (onActivity && status === "approved") onActivity(`Approved: ${f.title}`);
    if (["approved", "edited", "rejected"].includes(status)) track(`finding_${status}`, { case: inspection.id, finding: f.id, issue: f.issueId, flags: (f.review_flags || []).slice(0, 8), status: f.status });
    return true;
  }
  function startEdit(f) { const e = effective(f); setEditing({ id: f.id, defect: e.defect, works: e.remedial.works }); }
  function saveEdit(f) {
    decide(f, "edited", { reviewed: { ...(f.reviewed || {}), defect: editing.defect.trim(), works: editing.works.trim(), at: Date.now() } });
  }
  async function approveUnflagged() {
    let working = state;
    let n = 0;
    for (const f of live) {
      if (!["draft", "review_required"].includes(f.status)) continue;
      const ef = effective(f);
      if (needsAttention(ef) || (f.gate && f.gate.status !== "review_ready") || f.stale) continue;
      const { state: next, error } = transition(working, f.id, "approved", { currentFingerprint: currentFp(f), by: me && me.user ? me.user.id : null });
      if (error) continue;
      working = next; n += 1;
      reviewFinding(f.id, "approved", { snapshot: f.evidenceFingerprint });
    }
    if (n) { onFindings(working); onActivity && onActivity(`Approved ${n} unflagged finding${n === 1 ? "" : "s"}`); }
  }
  // deterministic re-pricing with the surveyor's quantities; no model involved
  async function recalc(f) {
    if (!qty || qty.id !== f.id) return;
    setQty((q) => ({ ...q, busy: true, error: null }));
    try {
      const items = (f.cost.lines || []).map((l) => ({ price_book_row_id: l.row_id, quantity: l.proposedQty, quantity_basis: l.basis, quantity_evidence: l.evidence, reason: l.reason }));
      const res = await priceWithQuantities(items, qty.values);
      const ok = await decide(f, "edited", { reviewed: { ...(f.reviewed || {}), pricing: res, quantities: qty.values, at: Date.now() }, reason: "surveyor confirmed quantities" });
      if (ok) setQty(null);
    } catch (e) { setQty((q) => ({ ...q, busy: false, error: e.message })); }
  }

  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const statusBar = cfg && (
    <div className="ss-ai-bar">
      <Sparkles size={15} />
      <span>
        {cfg.enabled ? <>Drafted by <b>{cfg.model}</b>, checked separately, against <b>{cfg.reference && cfg.reference.label}</b>.</> : <>Drafting is <b>off</b> on this server — it needs an ANTHROPIC_API_KEY.</>}
        {cfg.enabled && !cfg.transcription && <> Voice notes can't be transcribed here (no OPENAI_API_KEY) — issues with voice notes will be marked incomplete.</>}
      </span>
      {cfg.enabled && (
        <InfoTip title="What Draft findings does">
          <p>For each <b>issue</b> you've confirmed: it records what the photos, notes and voice notes actually show; works out the likely cause <b>without seeing your suspected cause</b>, then compares the two; sets the scope of works; picks legislation and price rows only from your firm's lists (the server does the sums); writes it up; then a separate check tests every claim against the evidence.</p>
          <p>Anything unsupported is <b>blocked</b>. Anything missing is marked <b>incomplete</b>. You approve explicitly — editing alone never approves.</p>
        </InfoTip>
      )}
    </div>
  );

  // ---- coverage ----------------------------------------------------------------------
  const coverageView = (
    <div className="ss-coverage">
      <div className="ss-section-label">Coverage</div>
      {cov.map(({ room, issues, loose, legacy, legacyFindings, nothing }) => (
        <div key={room.id} className="ss-cov-room">
          <div className="ss-cov-room-head"><b>{room.name}</b>{room.condition && <span className={`ss-cbadge ${room.condition.toLowerCase()}`}>{room.condition}</span>}</div>
          {issues.map(({ issue, finding, eligibility, failedMemos, unconfirmedLinks }) => {
            const st = progress && progress.statuses[issue.id];
            const ef = finding ? effective(finding) : null;
            const tone = !issue.confirmedBySurveyor ? "warn" : finding ? (finding.status === "approved" ? "ok" : finding.stale || (finding.gate && finding.gate.status !== "review_ready") ? "warn" : "") : eligibility.eligible ? "" : "dim";
            return (
              <div key={issue.id} className={`ss-cov-row ${tone}`}>
                <span className="ss-cov-ic">{tone === "ok" ? <Check size={13} /> : tone === "warn" ? <AlertTriangle size={13} /> : st && st !== "done" ? <Loader2 size={13} className="ss-spin" /> : <ChevronRight size={13} />}</span>
                <span className="ss-cov-main">
                  <span className="ss-cov-title">{issue.title}{!issue.confirmedBySurveyor && <Sparkles size={11} className="ss-inline-ic" />}</span>
                  <span className="ss-cov-sub">
                    {st && st !== "done" && st !== "failed" ? (st === "waiting" ? "connection lost — retrying" : st === "transcribing" ? "transcribing voice notes" : st === "analysing" ? "reading the evidence" : st) :
                    !issue.confirmedBySurveyor ? "AI-suggested — confirm before drafting" :
                    finding ? `${STATUS_LABEL[finding.status]}${finding.stale ? " · evidence changed" : finding.gate && finding.gate.status !== "review_ready" ? ` · ${GATE_LABEL[finding.gate.status]}` : ""}` :
                    eligibility.eligible ? `${(issue.evidence || []).filter((e) => e.kind === "photo").length} photo${(issue.evidence || []).filter((e) => e.kind === "photo").length === 1 ? "" : "s"} · not drafted yet` :
                    `Not eligible — ${eligibility.missing[0] || "no human evidence"}`}
                    {failedMemos.length ? ` · ${failedMemos.length} voice note${failedMemos.length === 1 ? "" : "s"} not transcribed` : ""}
                    {unconfirmedLinks ? ` · ${unconfirmedLinks} link${unconfirmedLinks === 1 ? "" : "s"} unconfirmed` : ""}
                  </span>
                </span>
                <span className="ss-cov-actions">
                  {!issue.confirmedBySurveyor && <button className="ss-link" onClick={() => onRoom(room.id, (r) => confirmIssue(r, issue.id))}><Check size={12} /> Confirm</button>}
                  {!issue.confirmedBySurveyor && <button className="ss-link" onClick={() => onRoom(room.id, (r) => deleteIssue(r, issue.id))}>Discard</button>}
                  {issue.confirmedBySurveyor && eligibility.eligible && !(progress && progress.running) && cfg && cfg.enabled && (
                    <button className="ss-link" onClick={() => draftIssues([{ room, issue }])}><Sparkles size={12} /> {finding ? "Re-draft" : "Draft"}</button>
                  )}
                  {issue.confirmedBySurveyor && !eligibility.eligible && onOpenRoom && <button className="ss-link" onClick={() => onOpenRoom(room.id)}>Add evidence</button>}
                </span>
                {ef && ef.review_flags && ef.review_flags.some((x) => flagSeverity(x) === "blocking") && <span className="ss-cov-block"><ShieldAlert size={12} /></span>}
              </div>
            );
          })}
          {(loose.photoIds.length > 0 || loose.memoIds.length > 0) && (
            <div className="ss-cov-row warn">
              <span className="ss-cov-ic"><AlertTriangle size={13} /></span>
              <span className="ss-cov-main">
                <span className="ss-cov-title">{issues.length ? "Evidence not linked to an issue" : "Evidence not organised into issues"}</span>
                <span className="ss-cov-sub">{loose.photoIds.length} photo{loose.photoIds.length === 1 ? "" : "s"}{loose.memoIds.length ? ` · ${loose.memoIds.length} voice note${loose.memoIds.length === 1 ? "" : "s"}` : ""} — nothing is drafted from these until you say what they're about</span>
              </span>
              <span className="ss-cov-actions"><button className="ss-link" onClick={() => setOrganising(room.id)}><FolderTree size={12} /> Organise</button></span>
            </div>
          )}
          {legacyFindings.length > 0 && !issues.length && (
            <div className="ss-cov-row dim">
              <span className="ss-cov-ic"><History size={13} /></span>
              <span className="ss-cov-main"><span className="ss-cov-title">Findings from the previous version</span><span className="ss-cov-sub">{legacyFindings.length} finding{legacyFindings.length === 1 ? "" : "s"} drafted per room, before issues existed — shown below, not verified</span></span>
            </div>
          )}
          {nothing && room.photoIds.length === 0 && (
            <div className="ss-cov-row dim"><span className="ss-cov-ic">—</span><span className="ss-cov-main"><span className="ss-cov-sub">No evidence recorded in this room</span></span></div>
          )}
          {nothing && room.photoIds.length > 0 && !legacy && (
            <div className="ss-cov-row dim"><span className="ss-cov-ic">—</span><span className="ss-cov-main"><span className="ss-cov-sub">No reportable issue raised — {room.photoIds.length} photo{room.photoIds.length === 1 ? "" : "s"} on file</span></span></div>
          )}
        </div>
      ))}
      {progress && progress.error && <div className="ss-gaps"><AlertTriangle size={13} /> {progress.error}</div>}
    </div>
  );

  // ---- one finding -------------------------------------------------------------------------
  function card(raw) {
    const f = effective(raw);
    const a = f.assessment || {};
    const room = roomOf(raw);
    const issue = issueOf(raw);
    const blockers = approvalBlockers(raw, currentFp(raw));
    const flags = sortFlags(f.review_flags || []);
    const blocking = flags.filter((x) => flagSeverity(x) === "blocking");
    // the confidence pill already says "low"; the flag would say it twice
    const warnings = flags.filter((x) => flagSeverity(x) === "warning" && x !== "low_confidence");
    const info = flags.filter((x) => flagSeverity(x) === "informational");
    const isEditing = editing && editing.id === f.id;
    const isQty = qty && qty.id === f.id;
    const openEv = (id) => setSheet({ id, finding: raw, room });
    const run = state.runs[raw.issueId];
    const canApprove = ["draft", "review_required", "edited"].includes(raw.status) && !blockers.length;
    const gateTone = raw.gate && raw.gate.status === "blocked" ? "block" : raw.gate && raw.gate.status === "incomplete_evidence" ? "incomplete" : raw.stale ? "block" : null;
    const unconfirmedLines = (f.cost.lines || []).filter((l) => !l.priced || l.qtySource === "assumed");
    return (
      <div key={f.id} className={`ss-finding-card ${raw.status} ${gateTone || ""}`}>
        <div className="ss-finding-head">
          <span className="ss-finding-title">{f.title}</span>
          <span className={`ss-finding-status ${raw.status}`}>{STATUS_LABEL[raw.status] || raw.status}</span>
        </div>
        <div className="ss-finding-sub">{room ? room.name : f.roomName}{issue ? ` · ${issue.title}` : raw.issueId === legacyIssueId(f.roomId) ? " · previous version" : ""}{run && run.at ? ` · ${when(run.at)}` : ""}</div>
        {issue && (
          <div className="ss-evstrip" aria-label="Evidence for this issue">
            {issuePhotoIds(issue).map((pid) => { const p = photoCache[pid]; return p ? <button key={pid} className="ss-evstrip-thumb" onClick={() => openEv(`PHOTO-${p.no}`)} title={`Photo ${p.no}`}><img src={p.thumb || p.dataUrl} alt="" /><small>{p.no}</small></button> : null; })}
            {issueMemoIds(issue).map((mid, i) => { const k = Object.keys((raw.evidence && raw.evidence.sources) || {}).find((id) => raw.evidence.sources[id].memoId === mid) || `MEMO-${i + 1}`; return <button key={mid} className="ss-evstrip-memo" onClick={() => openEv(k)}>🎙 {sourceLabelShort(k)}</button>; })}
          </div>
        )}

        {raw.legacy && <div className="ss-gate info"><History size={15} /><div><b>Drafted by the previous version.</b> No evidence record, no verification. Approving is still your explicit decision.</div></div>}
        {gateTone && (
          <div className={`ss-gate ${gateTone}`}>
            <ShieldAlert size={16} />
            <div>
              <b>{raw.stale ? "Inspection evidence changed since this draft was generated." : raw.gate.status === "blocked" ? "Held back by verification." : "Evidence incomplete."}</b>
              <ul>{(raw.stale ? raw.staleReasons : raw.gate.reasons).map((r, i) => <li key={i}>{r}</li>)}</ul>
              <span>{raw.stale ? "Regenerate, or review the updated evidence, before approving." : raw.gate.status === "blocked" ? "Regenerate after correcting the evidence, or reject." : "Fix the evidence (re-record or retype the voice note) and regenerate. It cannot be approved as complete."}</span>
            </div>
          </div>
        )}

        <div className="ss-chips">
          <span className={`ss-pill-conf ${f.confidence === "high" ? "ok" : "warn"}`} title={(f.confidence_reasons || []).join("; ")}>{f.confidence} confidence</span>
          {blocking.map((x) => <span key={x} className="ss-chip block"><ShieldAlert size={11} /> {flagLabel(x)}</span>)}
          {warnings.map((x) => <span key={x} className="ss-chip warn"><AlertTriangle size={11} /> {flagLabel(x)}</span>)}
          {info.length > 0 && <span className="ss-chip dim" title={info.map(flagLabel).join("; ")}>{info.length} note{info.length === 1 ? "" : "s"}</span>}
        </div>
        {(f.confidence_reasons || []).length > 0 && <p className="ss-conf-why">{f.confidence_reasons.join(" · ")}</p>}

        {/* cause: the independent view, the surveyor's view, and where they part */}
        {(a.likely_cause || f.surveyor_hypothesis) && (
          <div className={`ss-flag ${a.agreement === "disagree" ? "disagree" : a.agreement === "uncertain" ? "uncertain" : a.agreement === "agree" ? "agree" : "none"}`}>
            {a.agreement === "agree" ? <Check size={16} /> : a.agreement === "disagree" || a.agreement === "uncertain" ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
            <div>
              <b>{a.agreement === "disagree" ? "The evidence points elsewhere" : a.agreement === "uncertain" ? "Could go either way" : a.agreement === "agree" ? "The evidence supports your read" : "Cause from the evidence"}</b>
              <div className="kv">
                <span>Likely cause</span><span>{a.likely_cause || <em>not established</em>}{a.independent_confidence ? <span className="ss-muted"> · {a.independent_confidence} on the evidence alone</span> : null}</span>
                <span>Evidence for</span><span><EvidenceChips ids={a.supporting} onOpen={openEv} empty="none cited" /></span>
                {(a.contrary || []).length > 0 && <><span>Evidence against</span><span><EvidenceChips ids={a.contrary} onOpen={openEv} tone="warn" /></span></>}
                {f.surveyor_hypothesis && <><span>Your read</span><span>{f.surveyor_hypothesis}</span></>}
                {f.surveyor_hypothesis && <><span>Comparison</span><span>{a.agreement}</span></>}
              </div>
              {a.agreement !== "agree" && a.reasoning && <p>{a.reasoning}</p>}
              {(a.differences || []).length > 0 && <ul className="ss-diffs">{a.differences.map((d, i) => <li key={i}>{d}</li>)}</ul>}
              {(a.evidence_contradicting_surveyor || []).length > 0 && <p className="ss-muted">Against your read: <EvidenceChips ids={a.evidence_contradicting_surveyor} onOpen={openEv} tone="warn" /></p>}
              {(a.alternative_causes || []).length > 0 && <p>Also considered: {a.alternative_causes.join("; ")}.</p>}
              {(f.evidence_gaps || []).length > 0 && <p className="ss-muted">Missing: {f.evidence_gaps.join(" · ")}</p>}
            </div>
          </div>
        )}

        {isEditing ? (
          <div className="ss-edit-form">
            <label>Defect</label>
            <textarea rows={4} value={editing.defect} onChange={(e) => setEditing({ ...editing, defect: e.target.value })} />
            <label>Remedial works</label>
            <textarea rows={4} value={editing.works} onChange={(e) => setEditing({ ...editing, works: e.target.value })} />
            <p className="ss-fineprint">Saving keeps the AI's original beside your wording and marks the finding <b>edited</b>. It is not approved until you approve it.</p>
            <div className="ss-finding-actions">
              <button className="ss-btn ss-btn-primary" onClick={() => saveEdit(raw)}><Check size={15} /> Save changes</button>
              <button className="ss-btn ss-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="ss-finding-label">Defect</div>
            <p className="ss-finding-text">{f.defect}</p>
            {raw.reviewed && raw.reviewed.defect != null && raw.reviewed.defect !== raw.defect && <details className="ss-details"><summary>AI's original wording</summary><p className="ss-finding-text dim">{raw.defect}</p></details>}
            {f.photo_refs && f.photo_refs.length > 0 && <p className="ss-muted">Exhibits: <EvidenceChips ids={f.photo_refs.map((n) => `PHOTO-${n}`)} onOpen={openEv} /></p>}
            {f.cause_text && <><div className="ss-finding-label">Cause, as worded</div><p className="ss-finding-text">{f.cause_text}</p></>}

            <div className="ss-finding-label">Legislation</div>
            {(f.legislation || []).length || f.hhsrs_hazard ? (
              <div className="ss-chips">
                {(f.legal_refs || f.legislation.map((l) => ({ cite: l }))).map((l) => <span key={l.cite} className="ss-chip leg" title={l.reason || l.title || ""}><ShieldCheck size={11} /> {l.cite}</span>)}
                {f.hhsrs_hazard && <span className="ss-chip leg" title={f.hazard ? `${f.hazard.name}${f.hazard.evidence_basis ? ` — ${f.hazard.evidence_basis}` : ""}` : ""}>{f.hhsrs_hazard}</span>}
              </div>
            ) : <span className="ss-finding-leg-empty">Not clearly supported — left blank</span>}

            <div className="ss-finding-label">Remedial works</div>
            <div className="ss-scope"><FolderTree size={12} /> {SCOPE_LABEL[f.remedial.scope] || f.remedial.scope}</div>
            <p className="ss-finding-text">{f.remedial.works}</p>
            {f.remedial.scope_rationale && <p className="ss-scope-why">{f.remedial.scope_rationale}</p>}
            {(f.remedial.conditions || []).length > 0 && <div className="ss-chips">{f.remedial.conditions.map((c) => <span key={c} className="ss-chip warn">{c}</span>)}</div>}
            {(f.remedial.assumptions || []).length > 0 && <p className="ss-muted">Assumes: {f.remedial.assumptions.join("; ")}</p>}

            <div className="ss-finding-label">Estimated cost</div>
            {f.cost.unpriced
              ? <div className="ss-cost unpriced">Unpriced — {f.cost.basis || "no price book row fits"}</div>
              : <><div className="ss-cost">{money(f.cost.low)} – {money(f.cost.high)}</div><p className="ss-cost-basis">{f.cost.basis}{f.cost.priceBookVersion ? ` · price book ${f.cost.priceBookVersion}` : ""}{f.cost.confirmedBySurveyor ? " · quantities confirmed by you" : ""}</p></>}
            {(f.cost.lines || []).length > 0 && (
              <div className="ss-lines">
                {f.cost.lines.map((l) => (
                  <div key={l.row_id} className={`ss-line ${l.priced ? "" : "unpriced"}`}>
                    <span className="mono">{l.row_id}</span>
                    <span className="ss-line-work">{l.work}</span>
                    <span className="ss-line-qty">
                      {isQty ? (
                        <input type="number" inputMode="decimal" min="0" step="any" placeholder={l.qtyUnit} value={qty.values[l.row_id] ?? (l.qty || "")} onChange={(e) => setQty((q) => ({ ...q, values: { ...q.values, [l.row_id]: e.target.value } }))} />
                      ) : l.priced ? `× ${l.qty} ${l.qtyUnit}${l.qtySource === "assumed" ? " (assumed)" : l.qtySource === "surveyor" ? " (you)" : ""}` : `quantity needed (${l.qtyUnit})`}
                    </span>
                    <span className="ss-line-money">{l.priced ? `${money(l.low)}–${money(l.high)}` : "—"}</span>
                    {l.evidence && l.evidence.length > 0 && !isQty && <span className="ss-line-ev"><EvidenceChips ids={l.evidence} onOpen={openEv} /></span>}
                  </div>
                ))}
                {(f.cost.problems || []).filter((p) => !["quantity_required"].includes(p.problem)).map((p, i) => <p key={i} className="ss-muted">{p.row_id}: {p.detail}</p>)}
                {isQty ? (
                  <div className="ss-finding-actions">
                    <button className="ss-btn ss-btn-primary" disabled={qty.busy} onClick={() => recalc(raw)}>{qty.busy ? <Loader2 size={14} className="ss-spin" /> : <Check size={14} />} Recalculate from the price book</button>
                    <button className="ss-btn ss-btn-ghost" onClick={() => setQty(null)}>Cancel</button>
                    {qty.error && <span className="ss-muted">{qty.error}</span>}
                  </div>
                ) : unconfirmedLines.length > 0 && raw.status !== "rejected" && (
                  <button className="ss-link" onClick={() => setQty({ id: f.id, values: Object.fromEntries(unconfirmedLines.map((l) => [l.row_id, l.qty || ""])), busy: false })}><Pencil size={13} /> Confirm quantities</button>
                )}
              </div>
            )}

            {/* traceability: what the finding rests on, and what the checker found */}
            {raw.evidence && (
              <button className="ss-expander" onClick={() => toggle(`ev:${f.id}`)}>{open[`ev:${f.id}`] ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Evidence record · {(raw.evidence.observations || []).length} observation{(raw.evidence.observations || []).length === 1 ? "" : "s"}, {(raw.evidence.measurements || []).length} measurement{(raw.evidence.measurements || []).length === 1 ? "" : "s"}</button>
            )}
            {raw.evidence && open[`ev:${f.id}`] && (
              <div className="ss-evrecord">
                {(raw.evidence.observations || []).map((o) => <div key={o.id} className="ss-evrow"><span className="mono">{o.id}</span><span>{o.statement}</span><EvidenceChips ids={o.source_ids} onOpen={openEv} /></div>)}
                {(raw.evidence.measurements || []).map((o) => <div key={o.id} className="ss-evrow"><span className="mono">{o.id}</span><span>{o.statement}</span><EvidenceChips ids={o.source_ids} onOpen={openEv} /></div>)}
                {(raw.evidence.statements || []).map((o) => <div key={o.id} className="ss-evrow dim"><span className="mono">{o.id}</span><span>{o.statement}{o.asserts_cause ? " (states a cause — withheld from the blind assessment)" : ""}</span><EvidenceChips ids={o.source_ids} onOpen={openEv} /></div>)}
                {(raw.evidence.unreadable || []).map((u, i) => <div key={i} className="ss-evrow dim"><span className="mono">{u.source_id}</span><span>Not readable: {u.reason}</span></div>)}
                <div className="ss-muted" style={{ marginTop: 6 }}>Sources: {Object.entries(raw.evidence.sources || {}).map(([id, s]) => <span key={id} className="ss-srcline"><EvidenceChips ids={[id]} onOpen={openEv} />{s.linkSource ? <small> {linkSourceLabel(s.linkSource)}</small> : s.type === "note" ? <small> {s.source}</small> : s.type === "caption" ? <small> by {s.by}</small> : null}</span>)}</div>
              </div>
            )}
            {raw.verification && (
              <button className="ss-expander" onClick={() => toggle(`vf:${f.id}`)}>{open[`vf:${f.id}`] ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Verification · {(raw.verification.claims || []).filter((c) => c.support === "supported").length} supported, {(raw.verification.claims || []).filter((c) => c.support === "partially_supported").length} partial, {(raw.verification.claims || []).filter((c) => ["unsupported", "contradicted"].includes(c.support)).length} unsupported</button>
            )}
            {raw.verification && open[`vf:${f.id}`] && (
              <div className="ss-evrecord">
                {raw.verification.summary && <p className="ss-muted">{raw.verification.summary}</p>}
                {(raw.verification.claims || []).map((c, i) => (
                  <div key={i} className={`ss-claim ${c.support}`}>
                    <span className={`ss-support ${c.support}`}>{c.support.replace(/_/g, " ")}</span>
                    <span className="ss-claim-type">{c.type}</span>
                    <span className="ss-claim-text">{c.claim}{c.note ? <em> — {c.note}</em> : null}</span>
                    <EvidenceChips ids={c.source_ids} onOpen={openEv} />
                  </div>
                ))}
              </div>
            )}
            <button className="ss-expander" onClick={() => toggle(`hx:${f.id}`)}>{open[`hx:${f.id}`] ? <ChevronDown size={13} /> : <ChevronRight size={13} />} History &amp; audit</button>
            {open[`hx:${f.id}`] && (
              <div className="ss-evrecord ss-audit">
                {run && run.id ? (
                  <>
                    <div><b>Run</b> <span className="mono">{run.id}</span>{run.at ? ` · ${when(run.at)}` : ""}{run.durationMs ? ` · ${Math.round(run.durationMs / 1000)}s` : ""}</div>
                    <div><b>Provider</b> {run.provider || "—"} · <b>model</b> {run.model}{run.servedByFallback ? ` (fallback: ${run.servedByFallback})` : ""}{run.verifyModel && run.verifyModel !== run.model ? ` · verifier ${run.verifyModel}` : ""}</div>
                    {run.efforts && <div><b>Effort</b> {Object.entries(run.efforts).filter(([k]) => ["evidence", "causation", "analysis", "draft", "verify"].includes(k)).map(([k, v]) => `${k} ${v}`).join(", ")}</div>}
                    <div><b>Pipeline</b> {run.pipelineVersion || "1 (previous)"}{run.prompts ? ` · prompts ${Object.entries(run.prompts).map(([k, v]) => `${k}:${v}`).join(" ")}` : ""}</div>
                    {run.reference && <div><b>Reference</b> {run.reference.label}{run.reference.hashes ? ` · ${Object.entries(run.reference.hashes).map(([k, v]) => `${k}:${v}`).join(" ")}` : ""}</div>}
                    {run.snapshot && <div><b>Evidence snapshot</b> <span className="mono">{run.snapshot}</span>{raw.evidenceFingerprint && currentFp(raw) && currentFp(raw) !== raw.evidenceFingerprint ? <span className="ss-muted"> · current differs</span> : null}</div>}
                    {run.evidence && <div><b>Evidence</b> {run.evidence.photosAnalysed} photo{run.evidence.photosAnalysed === 1 ? "" : "s"} analysed{run.evidence.photosShownToCausation != null ? `, ${run.evidence.photosShownToCausation} shown to the cause analysis` : ""}{run.evidence.complete === false ? ` · incomplete: ${(run.evidence.incomplete || []).map((i) => i.source_id).join(", ")}` : ""}</div>}
                    {run.usage && <div><b>Tokens</b> in {run.usage.input} (cached {run.usage.cacheRead}) · out {run.usage.output}</div>}
                  </>
                ) : <div className="ss-muted">No run record — drafted by the previous version or a cloud workflow.</div>}
                <div><b>Created</b> {raw.createdAt ? when(raw.createdAt) : "—"}{raw.reviewedAt ? ` · last review action ${when(raw.reviewedAt)}` : ""}</div>
                {raw.approval && <div><b>Approved</b> {raw.approval.at ? when(raw.approval.at) : ""}{raw.approval.by ? ` by ${raw.approval.by === (me && me.user && me.user.id) ? "you" : raw.approval.by}` : ""}{raw.approval.legacy ? ` · ${raw.approval.note}` : ""}</div>}
                {raw.reviewed && <div><b>Your edits</b> {[raw.reviewed.defect != null && "defect wording", raw.reviewed.works != null && "remedial works", raw.reviewed.pricing && "quantities / cost"].filter(Boolean).join(", ") || "—"}{raw.reviewed.at ? ` · ${when(raw.reviewed.at)}` : ""}</div>}
                {(raw.revisions || []).length > 0 && (
                  <div><b>Earlier approvals</b>
                    <ul>{raw.revisions.map((r, i) => <li key={i}>approved {r.approval && r.approval.at ? when(r.approval.at) : ""}{r.approval && r.approval.by ? ` by ${r.approval.by}` : ""} → set aside {r.supersededAt ? when(r.supersededAt) : ""}: {r.reason}</li>)}</ul>
                  </div>
                )}
                {raw.supersededBy && <div><b>Superseded by</b> a newer draft{raw.supersededAt ? ` on ${when(raw.supersededAt)}` : ""}</div>}
              </div>
            )}

            <div className="ss-finding-actions">
              {canApprove && <button className="ss-btn ss-btn-primary" onClick={() => decide(raw, "approved")}><Check size={15} /> Approve</button>}
              {["draft", "review_required", "edited"].includes(raw.status) && blockers.length > 0 && <button className="ss-btn ss-btn-ghost" disabled title={blockers.join("; ")}><ShieldAlert size={14} /> Can't approve yet</button>}
              {raw.status !== "rejected" && raw.status !== "superseded" && !isEditing && <button className="ss-btn ss-btn-ghost" onClick={() => startEdit(raw)}><Pencil size={14} /> Edit</button>}
              {["draft", "review_required", "edited"].includes(raw.status) && <button className="ss-btn ss-btn-danger-ghost" onClick={() => decide(raw, "rejected")}><X size={15} /> Reject</button>}
              {["approved", "rejected", "edited"].includes(raw.status) && <button className="ss-btn ss-btn-ghost" onClick={() => decide(raw, "draft", { reason: "surveyor reopened" })}><RotateCcw size={14} /> Back to draft</button>}
            </div>
            {issue && room && cfg && cfg.enabled && !(progress && progress.running) && raw.status !== "approved" && (
              <div className="ss-regen">
                <button className="ss-link" onClick={() => draftIssues([{ room, issue }])} title="Re-run only the stages whose inputs changed; unchanged analysis is reused"><Sparkles size={12} /> Regenerate</button>
                <button className="ss-link" onClick={() => draftIssues([{ room, issue }], { force: ["verification"] })} title="Run the independent check again on this wording"><ShieldCheck size={12} /> Re-check only</button>
                <button className="ss-link" onClick={() => draftIssues([{ room, issue }], { force: ["draft", "verification"] })} title="Reword from the same analysis, then re-check"><Pencil size={12} /> Reword</button>
                <FeedbackButton screen="findings" caseId={inspection.id} findingId={f.id} preset="wrong_finding">Report a problem</FeedbackButton>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const sheetEl = sheet && <EvidenceSheet id={sheet.id} finding={sheet.finding} room={sheet.room} photoCache={photoCache} fullPhoto={fullPhoto} audioCache={audioCache} transcripts={transcripts} onTranscripts={onTranscripts} me={me} onClose={() => setSheet(null)} />;
  const organiseEl = organising && rooms.find((r) => r.id === organising) && (
    <OrganiseSheet caseId={inspection.id} room={rooms.find((r) => r.id === organising)} photoCache={photoCache} fullPhoto={fullPhoto} audioCache={audioCache} transcripts={transcripts} onTranscripts={onTranscripts} onRoom={(fn) => onRoom(organising, fn)} onActivity={onActivity} onClose={() => setOrganising(null)} />
  );
  const draftLabel = needsDraft.length ? `Draft findings (${needsDraft.length} issue${needsDraft.length === 1 ? "" : "s"})` : draftable.length ? "Re-draft all issues" : "Draft findings";
  const draftTargets = needsDraft.length ? needsDraft : draftable;

  const visible = live.filter((f) => f.status !== "rejected" || open["rejected"]);
  const rejected = live.filter((f) => f.status === "rejected").length;
  const superseded = (state.items || []).filter((f) => f.status === "superseded").length;

  return (
    <>
      <div className="ss-scroll">
        {statusBar}
        {notice && <div className="ss-note">{notice}</div>}
        {coverageView}
        {visible.length > 0 && (
          <div className="ss-findings-banner">
            <ShieldCheck size={16} />
            <span>Drafts, not findings. Every cause, citation and price here is traceable — tap an evidence chip to see the source. Approve what stands; edit what needs your wording (that doesn't approve it); reject what's wrong. Only approved findings reach the report.</span>
          </div>
        )}
        {visible.length === 0 && !(progress && progress.running) && (
          <div className="ss-empty">
            <ShieldCheck size={22} />
            <p>
              {draftable.length ? <>{draftable.length} issue{draftable.length === 1 ? " is" : "s are"} ready to draft from.</> : cov.some((c) => c.loose.photoIds.length) ? <>Organise each room's evidence into issues first — tap <b>Organise</b> above.</> : <>Raise an issue in a room and add a note, voice note or reading to draft from.</>}
            </p>
          </div>
        )}
        {rooms.map((room) => {
          const items = visible.filter((f) => f.roomId === room.id);
          if (!items.length) return null;
          return <div key={room.id} className="ss-room-run"><div className="ss-room-run-head"><h3>{room.name}</h3></div>{items.map(card)}</div>;
        })}
        {(rejected > 0 || superseded > 0) && (
          <button className="ss-expander" onClick={() => toggle("rejected")}>{open["rejected"] ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {rejected} rejected{superseded ? ` · ${superseded} superseded (kept in the case record)` : ""}</button>
        )}
        <div style={{ height: 12 }} />
      </div>
      <div className="ss-footer">
        {total > 0 && (
          <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginBottom: 8 }}>
            {approved} of {total} approved{attention ? ` · ${attention} need${attention === 1 ? "s" : ""} your attention` : ""}
          </div>
        )}
        <div className="ss-finding-actions" style={{ marginTop: 0 }}>
          {total > 0 && <button className="ss-btn ss-btn-primary" onClick={approveUnflagged} disabled={!live.some((f) => ["draft", "review_required"].includes(f.status) && !needsAttention(effective(f)) && !(f.gate && f.gate.status !== "review_ready") && !f.stale)}><Check size={16} /> Approve unflagged</button>}
          {progress && progress.running ? (
            <button className="ss-btn ss-btn-danger-ghost" onClick={cancelDraft}><X size={15} /> Cancel</button>
          ) : (
            <button className={`ss-btn ${total > 0 ? "ss-btn-ghost" : "ss-btn-primary"} ${total > 0 ? "" : "ss-btn-big"}`} onClick={() => draftIssues(draftTargets)} disabled={aiOff || !cfg || !draftTargets.length} title={aiOff ? "Set ANTHROPIC_API_KEY on the server" : !draftTargets.length ? "Confirm an issue with evidence first" : undefined}>
              <Sparkles size={15} /> {draftLabel}
            </button>
          )}
        </div>
      </div>
      {sheetEl}
      {organiseEl}
    </>
  );
}

