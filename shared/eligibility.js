// What counts as evidence a finding may be drafted from. One definition,
// imported by the phone (to show the coverage view) and by the server (which
// refuses to draft anything that fails it). Plain JS, no imports.
//
// The principle: AI-generated convenience text never makes an issue
// eligible on its own. Something a person did has to be in the chain — they
// typed it, said it, measured it, adopted the AI's suggestion, or confirmed
// the issue exists.

export const NOTE_SOURCES = ["human_typed", "human_adopted_ai", "ai_generated", "voice_transcript", "legacy_unknown"];
// text a person stands behind
export const HUMAN_NOTE_SOURCES = new Set(["human_typed", "human_adopted_ai", "voice_transcript"]);

export const ASSOCIATION_SOURCES = ["human_created", "capture_session", "ai_suggested", "human_confirmed_ai", "legacy_unassigned"];
// links a person made or confirmed — an AI suggestion alone is not one
export const CONFIRMED_ASSOCIATION = new Set(["human_created", "capture_session", "human_confirmed_ai"]);

const text = (s) => (typeof s === "string" ? s.trim() : "");

// `issue` is a defect cluster as the app stores it; `room` its room;
// `transcripts` the case's transcript records keyed by memo id.
// Returns { eligible, sources: [...what qualified...], missing: [...why not...] }
export function issueEligibility(issue, room, transcripts = {}) {
  const sources = [];
  const missing = [];
  if (!issue) return { eligible: false, sources, missing: ["no issue"] };
  const ev = Array.isArray(issue.evidence) ? issue.evidence : [];
  const photos = ev.filter((e) => e.kind === "photo");
  const memos = ev.filter((e) => e.kind === "memo");
  const readings = ev.filter((e) => e.kind === "reading");
  const confirmed = !!issue.confirmedBySurveyor;
  const confirmedPhotos = photos.filter((e) => CONFIRMED_ASSOCIATION.has(e.source)).length;

  if (text(issue.description) && issue.descriptionSource !== "ai_generated") sources.push("issue_description");
  if (text(issue.humanSuspectedCause)) sources.push("surveyor_hypothesis");
  if (memos.length) sources.push("voice_memo");
  if (readings.length) sources.push("measurement");
  if (room && text(room.note) && HUMAN_NOTE_SOURCES.has(room.noteSource || "legacy_unknown")) sources.push("room_note");
  if (room && text(room.hypothesis)) sources.push("room_hypothesis");
  // a rating alone is a mood; a rating on an issue the surveyor themselves raised is a statement
  if (room && ["Poor", "Fair"].includes(room.condition) && (confirmed || issue.createdBy === "surveyor")) sources.push("rated_issue");
  if (confirmed && (photos.length || memos.length || readings.length)) sources.push("confirmed_issue");

  if (!sources.length) {
    if (room && text(room.note) && !HUMAN_NOTE_SOURCES.has(room.noteSource || "legacy_unknown")) missing.push(room.noteSource === "ai_generated" ? "the only note is AI-generated — adopt or rewrite it" : "the note's origin is unknown — confirm the issue to draft from it");
    if (photos.length && !confirmed) missing.push("photos alone need the issue confirmed, a note, a voice note or a reading");
    if (!photos.length && !memos.length && !readings.length) missing.push("no evidence linked to this issue");
  }
  // an issue whose only photos are AI-suggested links the surveyor hasn't confirmed
  if (photos.length && !confirmedPhotos && !confirmed) sources.length && missing.push("photo links are AI-suggested and not yet confirmed");
  return { eligible: sources.length > 0 && !missing.length, sources, missing };
}
