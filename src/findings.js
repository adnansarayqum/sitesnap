// Findings as the phone keeps them — `inspection.findings`, riding along on
// the case so they work offline, sync to the register and survive the
// server having no database. Shape (version 2):
//
//   { version: 2,
//     runs:  { [issueId]: run },              // the latest pipeline run per issue (audit record)
//     runHistory: [ run, ... ],               // earlier runs, most recent first, capped
//     items: [ finding ] }
//
// A finding carries the AI's output at the top level (never overwritten), the
// surveyor's `reviewed` edits beside it, `status` under the state machine in
// shared/findingRules.js, the `gate` the verifier set, the evidence
// fingerprint it was drafted against, and `approval` / `revisions` for the
// history. `effective()` is what the report and the workbook read.
import { canTransition, isReportable, approvalBlockers, sortFlags } from "../shared/findingRules.js";
import { issueFingerprint, legacyIssueId, legacyIssue, openIssues, unassigned, eligibilityOf, transcriptUsable } from "./evidence.js";
export { needsAttention, flagLabel, flagSeverity, isReportable, approvalBlockers, canTransition, FLAGS } from "../shared/findingRules.js";

export const FINDINGS_VERSION = 2;
export const emptyFindings = () => ({ version: FINDINGS_VERSION, runs: {}, runHistory: [], items: [] });

// ---- migration ----------------------------------------------------------------------
// v1 findings were per room and `edited` was reportable through a button
// labelled "Save & approve". They stay reportable: migrated to `approved`
// with an approval record saying how. Drafts stay drafts; they are marked
// legacy so the screen can say they were not verified.
export function migrateFindings(state) {
  if (!state || !Array.isArray(state.items)) return emptyFindings();
  if (state.version >= FINDINGS_VERSION) return state;
  const at = new Date().toISOString();
  const items = state.items.map((f) => {
    const base = { ...f, issueId: f.issueId || legacyIssueId(f.roomId), legacy: true, gate: f.gate || { status: "review_ready", reasons: [], flags: f.review_flags || [], legacy: true }, evidenceFingerprint: f.evidenceFingerprint || null, revisions: f.revisions || [] };
    if (f.status === "edited") return { ...base, status: "approved", approval: { legacy: true, at, note: "migrated from edited: approved through the pre-2.0 \"Save & approve\" action" } };
    return base;
  });
  const runs = {};
  for (const [roomId, run] of Object.entries(state.runs || {})) runs[legacyIssueId(roomId)] = { ...run, legacy: true, issueId: legacyIssueId(roomId) };
  return { version: FINDINGS_VERSION, runs, runHistory: [], items };
}

// ---- merging a pipeline result ---------------------------------------------------------
export function mergeRun(state, { issue, room }, res) {
  const s = state && state.version >= FINDINGS_VERSION ? state : migrateFindings(state);
  const newId = res.finding.id;
  // earlier drafts for this issue that were never approved are superseded;
  // an approved one stays approved (the surveyor decides when it's replaced)
  const items = s.items.map((f) => (f.issueId === issue.id && f.id !== newId && ["draft", "review_required", "edited"].includes(f.status)
    ? { ...f, status: "superseded", supersededBy: newId, supersededAt: res.run.at }
    : f));
  if (!items.some((f) => f.id === newId)) {
    items.push({ ...res.finding, issueId: issue.id, roomId: room.id, roomName: room.name, issueTitle: issue.title, status: "draft", createdAt: res.run.at, runId: res.run.id, evidenceFingerprint: res.run.snapshot || res.finding.evidenceFingerprint || null, revisions: [] });
  }
  const prior = s.runs[issue.id];
  return {
    ...s,
    runs: { ...s.runs, [issue.id]: res.run },
    runHistory: prior ? [prior, ...(s.runHistory || [])].slice(0, 12) : (s.runHistory || []),
    items: items.sort((a, b) => (a.roomName === b.roomName ? String(a.issueTitle).localeCompare(String(b.issueTitle)) : 0)),
  };
}

// ---- the state machine, enforced on the phone too ----------------------------------------
// Returns { state, error } — the screen shows `error` rather than pretending.
export function transition(state, id, status, { reviewed, currentFingerprint, by, reason } = {}) {
  const f = state.items.find((x) => x.id === id);
  if (!f) return { state, error: "finding not found" };
  if (!canTransition(f.status, status)) return { state, error: `a ${f.status} finding cannot become ${status}` };
  const now = new Date().toISOString();
  let next = { ...f, status, reviewedAt: now };
  if (reviewed !== undefined) next.reviewed = reviewed;
  if (status === "approved") {
    const blockers = approvalBlockers(f, currentFingerprint);
    if (blockers.length) return { state, error: blockers.join("; "), blockers };
    next.approval = { by: by || null, at: now, fingerprint: f.evidenceFingerprint, runId: f.runId };
    next.stale = false;
    next.review_flags = (f.review_flags || []).filter((x) => x !== "stale_analysis");
  } else if (f.status === "approved" && f.approval) {
    next.revisions = [...(f.revisions || []), { status: "approved", approval: f.approval, reviewed: f.reviewed || null, supersededAt: now, reason: reason || `moved to ${status}` }];
    next.approval = null;
  }
  return { state: { ...state, items: state.items.map((x) => (x.id === id ? next : x)) }, error: null };
}

// ---- staleness: the evidence moved under a finding ------------------------------------------
// Run whenever the Findings tab has the current evidence in view. An approved
// finding whose evidence changed goes back to review_required, keeping its
// approved revision; any live finding gets the blocking stale_analysis flag
// until it is regenerated. `refState` is /api/ai/config's reference block.
export function reconcile(state, { rooms, photoCache, transcripts, refState }) {
  if (!state || !Array.isArray(state.items)) return { state, changed: [] };
  const changed = [];
  const roomsById = Object.fromEntries((rooms || []).map((r) => [r.id, r]));
  const items = state.items.map((f) => {
    if (["superseded", "rejected"].includes(f.status)) return f;
    const room = roomsById[f.roomId];
    const issue = room ? (room.issues || []).find((i) => i.id === f.issueId) || (f.issueId === legacyIssueId(room.id) ? legacyIssue(room) : null) : null;
    const reasons = [];
    if (f.evidenceFingerprint && room && issue) {
      const now = issueFingerprint(issue, room, photoCache, transcripts);
      if (now !== f.evidenceFingerprint) reasons.push("inspection evidence changed since this draft was generated");
    } else if (f.evidenceFingerprint && (!room || !issue)) reasons.push("the issue this finding was drafted for no longer exists");
    const run = state.runs && state.runs[f.issueId];
    if (refState && run && run.reference && run.reference.cited) {
      const c = run.reference.cited;
      for (const [id, h] of Object.entries(c.priceRows || {})) if (refState.priceRows && refState.priceRows[id] !== h) reasons.push(`price book row ${id} changed since drafting`);
      for (const [id, h] of Object.entries(c.legal || {})) if (refState.legalEntries && refState.legalEntries[id] !== h) reasons.push(`legal register entry ${id} changed since drafting`);
      for (const [id, h] of Object.entries(c.hazard || {})) if (refState.hazards && refState.hazards[id] !== h) reasons.push(`HHSRS entry ${id} changed since drafting`);
    }
    const wasStale = !!f.stale;
    if (reasons.length) {
      let next = { ...f, stale: true, staleReasons: reasons, review_flags: sortFlags([...(f.review_flags || []), "stale_analysis"]) };
      if (f.status === "approved") {
        next = { ...next, status: "review_required", revisions: [...(f.revisions || []), { status: "approved", approval: f.approval, reviewed: f.reviewed || null, supersededAt: new Date().toISOString(), reason: reasons.join("; ") }], approval: null };
      }
      if (!wasStale || f.status === "approved") changed.push({ id: f.id, reasons });
      return next;
    }
    if (wasStale) { changed.push({ id: f.id, reasons: [] }); return { ...f, stale: false, staleReasons: [], review_flags: (f.review_flags || []).filter((x) => x !== "stale_analysis") }; }
    return f;
  });
  return { state: changed.length ? { ...state, items } : state, changed };
}

// ---- what the report and the workbook see -----------------------------------------------------
// The AI's draft stays as written; the surveyor's edits (wording, works,
// a deterministic re-pricing with confirmed quantities) overlay it. Pricing
// flags clear only when the re-pricing actually settled every line.
const PRICING_FLAGS = new Set(["unpriced", "quantity_unconfirmed", "price_assumption"]);
export function effectiveFlags(f) {
  const flags = f.review_flags || [];
  const p = f.reviewed && f.reviewed.pricing;
  if (p && !p.unpriced && !(p.lines || []).some((l) => l.priced && l.qtySource === "assumed")) return flags.filter((x) => !PRICING_FLAGS.has(x));
  return flags;
}
export function effective(f) {
  const flags = effectiveFlags(f);
  if (!f.reviewed) return flags === f.review_flags ? f : { ...f, review_flags: flags };
  const r = f.reviewed;
  const p = r.pricing;
  return {
    ...f,
    review_flags: flags,
    defect: r.defect ?? f.defect,
    remedial: { ...f.remedial, works: r.works ?? f.remedial.works },
    cost: p
      ? { ...f.cost, low: p.unpriced ? 0 : p.low, high: p.unpriced ? 0 : p.high, unpriced: p.unpriced, basis: p.basis, price_book_refs: p.price_book_refs, lines: p.lines, problems: p.problems, priceBookVersion: p.priceBookVersion, confirmedBySurveyor: true }
      : { ...f.cost, low: r.costLow ?? f.cost.low, high: r.costHigh ?? f.cost.high, unpriced: r.costLow != null ? false : f.cost.unpriced, basis: r.costBasis ?? f.cost.basis },
    legislation: r.legislation ?? f.legislation,
  };
}
export const isApproved = isReportable;
export const liveItems = (state) => ((state && state.items) || []).filter((f) => f.status !== "superseded");
export function approvedByRoom(state, rooms) {
  if (!state || !state.items) return [];
  return (rooms || []).map((r) => ({ room: r.name, roomId: r.id, findings: state.items.filter((f) => f.roomId === r.id && isReportable(f)).map(effective) })).filter((r) => r.findings.length);
}

// ---- coverage: what the system did and did not process ------------------------------------------
// One row per issue per room, plus the room's loose evidence and any voice
// note that could not be transcribed — so nothing is skipped silently.
export function coverage(rooms, state, transcripts = {}) {
  const items = liveItems(state);
  return (rooms || []).map((room) => {
    const issues = openIssues(room).map((issue) => {
      const finding = items.filter((f) => f.issueId === issue.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      const el = eligibilityOf(issue, room, transcripts);
      const failedMemos = (issue.evidence || []).filter((e) => e.kind === "memo" && !transcriptUsable(transcripts[e.id])).map((e) => e.id);
      return { issue, finding, eligibility: el, failedMemos, unconfirmedLinks: (issue.evidence || []).filter((e) => !["capture_session", "human_created", "human_confirmed_ai"].includes(e.source)).length };
    });
    const loose = unassigned(room);
    const legacy = legacyIssue(room);
    const legacyFindings = items.filter((f) => f.issueId === legacyIssueId(room.id));
    return { room, issues, loose, legacy, legacyFindings, nothing: !issues.length && !legacy && !legacyFindings.length };
  });
}

// ---- exports -------------------------------------------------------------------------------------------
export const SCHEDULE_COLUMNS = ["Item", "Location", "Defect", "Cause", "Legislation", "HHSRS", "Remedial works", "Scope", "Conditions", "Price low", "Price high", "Price basis", "Photos", "Confidence"];
export function scheduleRows(byRoom) {
  const rows = []; let n = 0;
  for (const { room, findings } of byRoom) {
    for (const f of findings) {
      n += 1;
      rows.push([n, `${room} — ${f.location}`, f.defect, (f.assessment || {}).likely_cause || "", (f.legislation || []).join("; "), f.hhsrs_hazard || "",
        f.remedial.works, f.remedial.scope, (f.remedial.conditions || []).join("; "),
        f.cost.unpriced ? "" : f.cost.low, f.cost.unpriced ? "" : f.cost.high, f.cost.basis,
        (f.photo_refs || []).map((p) => `Photo ${p}`).join(", "), f.confidence]);
    }
  }
  return rows;
}
export function toCsv(rows) {
  const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [SCHEDULE_COLUMNS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
export function findingsFiles(state, rooms) {
  const byRoom = approvedByRoom(state, rooms);
  if (!byRoom.length) return [];
  const csv = new File([toCsv(scheduleRows(byRoom))], "findings.csv", { type: "text/csv" });
  const json = new File([JSON.stringify({ exported: new Date().toISOString(), onlyApproved: true, rooms: byRoom.map((r) => ({ ...r, findings: r.findings.map(exportView) })) }, null, 2)], "draft-findings.json", { type: "application/json" });
  return [csv, json];
}
// the audit fields a report consumer needs, without the stage bulk
export function exportView(f) {
  const { evidence, verification, ...rest } = f;
  return { ...rest, evidenceSources: evidence ? Object.keys(evidence.sources || {}) : [], verificationSummary: verification ? verification.summary : null };
}

// The old cloud-workflow shape (docs/cloud-workflow.md) still arrives when a
// Make/n8n scenario replies with findings; lift it into the new shape with the
// fields it lacks marked for review. Never reportable until approved.
export function fromLegacyDraft(json, rooms) {
  if (!json || !Array.isArray(json.rooms)) return null;
  const state = emptyFindings();
  for (const lr of json.rooms) {
    const room = rooms.find((r) => r.name === lr.room_name) || { id: `legacy_${lr.room_name}`, name: lr.room_name };
    (lr.findings || []).forEach((f, i) => {
      state.items.push({
        id: `legacy_${room.id}_${i}`, roomId: room.id, roomName: room.name, issueId: legacyIssueId(room.id), issueTitle: "Cloud workflow draft", seq: i + 1, status: "draft", legacy: true,
        title: String(f.defect || "").slice(0, 60), location: room.name, defect: f.defect, photo_refs: [], surveyor_hypothesis: "",
        assessment: { likely_cause: "", agreement: "no_hypothesis", reasoning: "Drafted by the cloud workflow, not by SiteSnap's own pipeline — no evidence assessment, no verification.", alternative_causes: [] },
        legislation: f.legislation_breached ? [f.legislation_breached] : [], hhsrs_hazard: "",
        remedial: { works: f.remedial_action, scope: "localised", scope_rationale: "", conditions: [] },
        cost: { low: 0, high: 0, currency: "GBP", basis: "", price_book_refs: [], unpriced: true },
        confidence: "low", confidence_reasons: ["not produced by the verified pipeline"], review_flags: ["unpriced", "no_photo_evidence", "legal_check"],
        gate: { status: "review_ready", reasons: [], flags: [], legacy: true }, revisions: [],
      });
    });
    state.runs[legacyIssueId(room.id)] = { id: "legacy", at: new Date().toISOString(), model: "cloud workflow", legacy: true };
  }
  return state;
}
