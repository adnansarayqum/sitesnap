// The evidence model on the phone: issues (defect clusters) inside a room,
// the links from evidence to an issue with where each link came from, the
// provenance of notes and transcripts, and the fingerprint a finding is
// drafted against. All pure functions over the room/inspection objects the
// app already stores, so they ride along on the same save and the same sync.
//
//   room.issues[]        { id, title, description, descriptionSource, humanSuspectedCause,
//                          status: open|merged, createdAt, updatedAt, createdBy: surveyor|ai|legacy,
//                          associationSource, confirmedBySurveyor, confirmedAt,
//                          evidence: [{ id, kind: photo|memo|reading, source, at, legacyOrigin? }] }
//   room.activeIssueId   the issue new evidence attaches to while shooting
//   room.noteSource      human_typed | human_adopted_ai | ai_generated | voice_transcript | legacy_unknown
//   room.aiNote          { text, model, at, adopted, adoptedAt, adoptedBy, adoptedText }
//   room.readings[]      { id, text, value, unit, at }
//   inspection.transcripts[memoId]  { original, text, corrected, status, version, provider, model, audioHash, at, correctedAt }
import { uid } from "./lib/util.js";
import { hashJson } from "./lib/hash.js";
import { HUMAN_NOTE_SOURCES, CONFIRMED_ASSOCIATION, issueEligibility } from "../shared/eligibility.js";

export const ROOM_MODEL_VERSION = 2;
export const LEGACY_PREFIX = "legacy_";
export const legacyIssueId = (roomId) => `${LEGACY_PREFIX}${roomId}`;

// ---- migration: old cases open exactly as they were, with honest provenance -----
export function migrateRoom(room) {
  if (!room || room.modelVersion >= ROOM_MODEL_VERSION) return room;
  const next = { ...room, modelVersion: ROOM_MODEL_VERSION, issues: Array.isArray(room.issues) ? room.issues : [], readings: Array.isArray(room.readings) ? room.readings : [] };
  // we cannot know who wrote a pre-2.0 note: the old caption pass wrote the
  // AI's room note straight into this field with no marker
  if ((room.note || "").trim() && !room.noteSource) next.noteSource = "legacy_unknown";
  if (!("activeIssueId" in next)) next.activeIssueId = null;
  return next;
}
export const migrateRooms = (rooms) => (rooms || []).map(migrateRoom);

// pre-2.0 transcripts were bare strings keyed by memo id
export function migrateTranscripts(t) {
  const out = {};
  for (const [memoId, v] of Object.entries(t || {})) {
    if (v && typeof v === "object" && "status" in v) { out[memoId] = v; continue; }
    const text = typeof v === "string" ? v : "";
    out[memoId] = text
      ? { original: text, text, corrected: "", status: "complete", version: 1, provider: "legacy_unknown", model: null, audioHash: null, at: null }
      : { original: "", text: "", corrected: "", status: "failed", version: 1, provider: "legacy_unknown", model: null, audioHash: null, at: null };
  }
  return out;
}

// ---- transcript records --------------------------------------------------------------
export function transcriptFromServer(memoId, rec) {
  return { memoId, original: rec.text || "", text: rec.text || "", corrected: "", status: rec.text ? "complete" : "failed", version: 1, provider: rec.provider || null, model: rec.model || null, audioHash: rec.audioHash || null, at: rec.at || new Date().toISOString() };
}
export const failedTranscript = (reason) => ({ original: "", text: "", corrected: "", status: reason === "unavailable" ? "unavailable" : "failed", version: 1, provider: null, model: null, audioHash: null, at: new Date().toISOString(), error: reason || null });
// the surveyor's correction sits beside the original, never over it
export function correctTranscript(rec, corrected, by) {
  const c = (corrected || "").trim();
  if (!rec) return rec;
  if (!c || c === rec.original) return { ...rec, corrected: "", text: rec.original, status: rec.original ? "complete" : rec.status, version: (rec.version || 1) + 1, correctedAt: null, correctedBy: null };
  return { ...rec, corrected: c, text: c, status: "corrected", version: (rec.version || 1) + 1, correctedAt: new Date().toISOString(), correctedBy: by || null };
}
export const transcriptUsable = (rec) => !!(rec && ["complete", "corrected"].includes(rec.status) && (rec.text || "").trim());

// ---- AI room note: a suggestion until a person adopts it -------------------------------
export function suggestAiNote(room, text, model) {
  if (!text || !text.trim()) return room;
  return { ...room, aiNote: { text: text.trim(), model: model || null, at: new Date().toISOString(), adopted: false } };
}
export function adoptAiNote(room, by, editedText) {
  if (!room.aiNote) return room;
  const text = (editedText != null ? editedText : room.aiNote.text).trim();
  return {
    ...room, note: text, noteSource: "human_adopted_ai",
    aiNote: { ...room.aiNote, adopted: true, adoptedAt: new Date().toISOString(), adoptedBy: by || null, adoptedText: text },
  };
}
export const dismissAiNote = (room) => ({ ...room, aiNote: room.aiNote ? { ...room.aiNote, dismissed: true, dismissedAt: new Date().toISOString() } : null });
// any keystroke by a person on the note makes it theirs — an adopted AI note
// keeps its origin record but the field is now human text
export function typeNote(room, text) {
  const source = room.noteSource === "human_adopted_ai" && room.aiNote && text.trim() === (room.aiNote.adoptedText || "").trim() ? "human_adopted_ai" : "human_typed";
  return { ...room, note: text, noteSource: text.trim() ? source : undefined };
}
export const noteIsHuman = (room) => !!(room && (room.note || "").trim() && HUMAN_NOTE_SOURCES.has(room.noteSource));

// ---- issues -------------------------------------------------------------------------------
export function newIssue(title, { createdBy = "surveyor", source = "human_created", confirmed = createdBy === "surveyor" } = {}) {
  const now = Date.now();
  return {
    id: uid("iss"), title: (title || "Issue").trim().slice(0, 80), description: "", descriptionSource: "human_typed", humanSuspectedCause: "",
    status: "open", createdAt: now, updatedAt: now, createdBy, associationSource: source,
    confirmedBySurveyor: !!confirmed, confirmedAt: confirmed ? now : null, evidence: [],
  };
}
export const issueById = (room, id) => (room.issues || []).find((i) => i.id === id) || null;
export const issueFor = (room, evidenceId) => (room.issues || []).find((i) => (i.evidence || []).some((e) => e.id === evidenceId)) || null;
export const issuePhotoIds = (issue) => (issue.evidence || []).filter((e) => e.kind === "photo").map((e) => e.id);
export const issueMemoIds = (issue) => (issue.evidence || []).filter((e) => e.kind === "memo").map((e) => e.id);
export const issueReadingIds = (issue) => (issue.evidence || []).filter((e) => e.kind === "reading").map((e) => e.id);

export function addIssue(room, title, opts) {
  const issue = newIssue(title, opts);
  return { room: { ...room, issues: [...(room.issues || []), issue], activeIssueId: issue.id }, issue };
}
export function updateIssue(room, issueId, patch) {
  return { ...room, issues: (room.issues || []).map((i) => (i.id === issueId ? { ...i, ...patch, updatedAt: Date.now() } : i)) };
}
export function confirmIssue(room, issueId) {
  return {
    ...room,
    issues: (room.issues || []).map((i) => (i.id === issueId
      ? { ...i, confirmedBySurveyor: true, confirmedAt: Date.now(), updatedAt: Date.now(), evidence: (i.evidence || []).map((e) => (e.source === "ai_suggested" ? { ...e, source: "human_confirmed_ai", confirmedAt: Date.now() } : e.source === "legacy_unassigned" ? { ...e, source: "human_created", legacyOrigin: true, confirmedAt: Date.now() } : e)) }
      : i)),
  };
}
export function setActiveIssue(room, issueId) { return { ...room, activeIssueId: issueId || null }; }

// an item belongs to at most one issue; linking it moves it
export function linkEvidence(room, issueId, { id, kind, source }, at = Date.now()) {
  const issues = (room.issues || []).map((i) => ({ ...i, evidence: (i.evidence || []).filter((e) => e.id !== id) }));
  const target = issues.find((i) => i.id === issueId);
  if (target) { target.evidence = [...target.evidence, { id, kind, source: source || "human_created", at }]; target.updatedAt = at; }
  return { ...room, issues };
}
// room-level / general: in no issue
export function unlinkEvidence(room, id) {
  return { ...room, issues: (room.issues || []).map((i) => ((i.evidence || []).some((e) => e.id === id) ? { ...i, evidence: i.evidence.filter((e) => e.id !== id), updatedAt: Date.now() } : i)) };
}
export function removeEvidenceEverywhere(room, id) { return unlinkEvidence(room, id); }
export function deleteIssue(room, issueId) {
  return { ...room, issues: (room.issues || []).filter((i) => i.id !== issueId), activeIssueId: room.activeIssueId === issueId ? null : room.activeIssueId };
}
export function mergeIssues(room, fromId, intoId, by) {
  const from = issueById(room, fromId), into = issueById(room, intoId);
  if (!from || !into) return room;
  const moved = (from.evidence || []).filter((e) => !(into.evidence || []).some((x) => x.id === e.id)).map((e) => ({ ...e, movedFrom: fromId }));
  return {
    ...room,
    issues: (room.issues || []).map((i) => (i.id === intoId
      ? { ...i, evidence: [...(i.evidence || []), ...moved], updatedAt: Date.now(), merges: [...(i.merges || []), { from: fromId, title: from.title, at: Date.now(), by: by || null, reason: "surveyor merged" }], humanSuspectedCause: i.humanSuspectedCause || from.humanSuspectedCause, description: [i.description, from.description].filter(Boolean).join("\n") }
      : i.id === fromId ? { ...i, status: "merged", mergedInto: intoId, evidence: [], updatedAt: Date.now() } : i)),
    activeIssueId: room.activeIssueId === fromId ? intoId : room.activeIssueId,
  };
}

// evidence in the room that no open issue holds
export function unassigned(room) {
  const held = new Set((room.issues || []).filter((i) => i.status !== "merged").flatMap((i) => (i.evidence || []).map((e) => e.id)));
  return {
    photoIds: (room.photoIds || []).filter((id) => !held.has(id)),
    memoIds: (room.memos || []).map((m) => m.id).filter((id) => !held.has(id)),
    readingIds: (room.readings || []).map((r) => r.id).filter((id) => !held.has(id)),
  };
}
export const openIssues = (room) => (room.issues || []).filter((i) => i.status !== "merged");

// An explicit, honest stand-in for a room whose evidence was never
// organised: every unassigned item, linked as legacy_unassigned, not
// confirmed. It is never drafted from as it stands — the surveyor confirms
// it ("treat as one issue"), splits it with suggestions, or organises by hand.
export function legacyIssue(room) {
  const u = unassigned(room);
  if (!u.photoIds.length && !u.memoIds.length && !u.readingIds.length) return null;
  const at = room.startedAt || 0;
  return {
    id: legacyIssueId(room.id), title: "Unassigned evidence", description: "", descriptionSource: "human_typed", humanSuspectedCause: room.hypothesis || "",
    status: "open", createdAt: at, updatedAt: at, createdBy: "legacy", associationSource: "legacy_unassigned", confirmedBySurveyor: false, confirmedAt: null, virtual: true,
    evidence: [
      ...u.photoIds.map((id) => ({ id, kind: "photo", source: "legacy_unassigned", at })),
      ...u.memoIds.map((id) => ({ id, kind: "memo", source: "legacy_unassigned", at })),
      ...u.readingIds.map((id) => ({ id, kind: "reading", source: "legacy_unassigned", at })),
    ],
  };
}
// the surveyor says the room's loose evidence is one issue: it becomes real
export function adoptLegacyIssue(room, title) {
  const v = legacyIssue(room);
  if (!v) return { room, issue: null };
  const issue = { ...v, id: uid("iss"), title: (title || room.name || "Issue").trim().slice(0, 80), virtual: undefined, createdBy: "surveyor", associationSource: "human_created", confirmedBySurveyor: true, confirmedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), evidence: v.evidence.map((e) => ({ ...e, source: "human_created", legacyOrigin: true, confirmedAt: Date.now() })) };
  return { room: { ...room, issues: [...(room.issues || []), issue], activeIssueId: issue.id }, issue };
}
// AI-suggested clusters land unconfirmed, with every link marked as a suggestion
export function addSuggestedIssues(room, suggestions) {
  let next = room;
  const created = [];
  for (const sg of suggestions || []) {
    const issue = { ...newIssue(sg.title, { createdBy: "ai", source: "ai_suggested", confirmed: false }), suggestion: { confidence: sg.confidence, rationale: sg.rationale, model: sg.model || null, at: Date.now() } };
    next = { ...next, issues: [...(next.issues || []), issue] };
    for (const id of sg.photoIds || []) next = linkEvidence(next, issue.id, { id, kind: "photo", source: "ai_suggested" });
    for (const id of sg.memoIds || []) next = linkEvidence(next, issue.id, { id, kind: "memo", source: "ai_suggested" });
    created.push(issue.id);
  }
  return { room: next, created };
}
export const linkConfirmed = (e) => CONFIRMED_ASSOCIATION.has(e.source);

// ---- readings -------------------------------------------------------------------------------------
export function addReading(room, { text, value, unit }, issueId) {
  const reading = { id: uid("rd"), text: (text || "").trim(), value: value == null ? "" : String(value).trim(), unit: (unit || "").trim(), at: Date.now() };
  let next = { ...room, readings: [...(room.readings || []), reading] };
  if (issueId) next = linkEvidence(next, issueId, { id: reading.id, kind: "reading", source: "capture_session" });
  return { room: next, reading };
}
export function deleteReading(room, id) {
  return unlinkEvidence({ ...room, readings: (room.readings || []).filter((r) => r.id !== id) }, id);
}

// ---- what a finding is drafted against ---------------------------------------------------------
// Everything material to the analysis, in a stable order. Human captions
// count (the evidence step may rely on them); AI captions don't. Reference
// pack changes are checked separately (see findings.js) because the phone
// doesn't hold the pack.
export function issueFingerprint(issue, room, photoCache = {}, transcripts = {}) {
  const photos = issuePhotoIds(issue).slice().sort().map((id) => { const p = photoCache[id] || {}; return [id, p.no || null, p.captionAi ? "" : (p.caption || "").trim()]; });
  const memos = issueMemoIds(issue).slice().sort().map((id) => { const t = transcripts[id]; return [id, t ? t.status : "none", t ? (t.text || "").trim() : ""]; });
  const readings = issueReadingIds(issue).slice().sort().map((id) => { const r = (room.readings || []).find((x) => x.id === id) || {}; return [id, r.text || "", r.value || "", r.unit || ""]; });
  return hashJson({
    v: 2, issue: issue.id, photos, memos, readings,
    desc: issue.descriptionSource === "ai_generated" ? "" : (issue.description || "").trim(),
    cause: (issue.humanSuspectedCause || "").trim(),
    note: noteIsHuman(room) ? (room.note || "").trim() : "", noteSource: room.noteSource || "",
    hyp: (room.hypothesis || "").trim(), condition: room.condition || "",
  });
}

// the pipeline's view of an issue's evidence — what the phone sends
export function eligibilityOf(issue, room, transcripts) { return issueEligibility(issue, room, transcripts); }
