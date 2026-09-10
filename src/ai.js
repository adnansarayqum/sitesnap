// The phone's side of the AI service (server/ai/*, server/ai-routes.js).
// Network calls only; the findings and evidence models live in findings.js
// and evidence.js.
import { drawScaled, loadImage } from "./lib/image.js";
import { issuePhotoIds, issueMemoIds, issueReadingIds, noteIsHuman } from "./evidence.js";
export { approvedByRoom, findingsFiles, fromLegacyDraft, effective, isApproved, needsAttention, emptyFindings, mergeRun, SCHEDULE_COLUMNS, scheduleRows, toCsv } from "./findings.js";

// Claude reads images best at or under ~1568px on the long edge; the stored
// copy is 2200px, so the AI copy is re-encoded from it — smaller request,
// same evidence.
export const AI_DIM = 1568;
// must match MAX_PHOTOS in server/ai-routes.js
export const AI_MAX_PHOTOS = 60;
export const AI_CAPTION_MAX = 24;

let cfgCache = null;
export async function aiConfig(force = false) {
  if (cfgCache && !force) return cfgCache;
  try {
    const r = await fetch("/api/ai/config", { cache: "no-store" });
    cfgCache = r.ok ? await r.json() : { enabled: false, transcription: false };
  } catch { cfgCache = { enabled: false, transcription: false, offline: true }; }
  return cfgCache;
}

export async function aiPhotoCopy(dataUrl) {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  return drawScaled(img, w, h, AI_DIM, 0.8);
}

async function readError(r, fallback) {
  const j = await r.json().catch(() => ({}));
  const e = new Error(j.message || fallback);
  e.code = j.error || String(r.status);
  e.status = r.status;
  e.body = j;
  return e;
}
const json = (body, signal) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
export const newRequestId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

export async function transcribeMemo(caseId, roomId, memo, blob, signal) {
  const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}/rooms/${encodeURIComponent(roomId)}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": blob.type || memo.type || "audio/webm", "x-memo-id": memo.id, "x-filename": `note.${(memo.type || "audio/webm").split("/")[1].split(";")[0]}` },
    body: blob, signal,
  });
  if (!r.ok) throw await readError(r, "Couldn't transcribe this voice note.");
  return r.json(); // { text, provider, model, audioHash, at }
}

// Builds the pipeline request for one issue: every linked photograph (as an
// AI copy), every linked voice note with its transcript record, readings,
// the room's human note, and the minimum of context. Nothing about the
// client, occupier, solicitor or address is sent.
export async function issueRequest({ inspection, room, issue, order, photoCache, transcripts, fullPhoto, requestId, snapshot, quantityOverrides, prior, force }) {
  const photos = [];
  for (const pid of issuePhotoIds(issue).slice(0, AI_MAX_PHOTOS)) {
    const p = await fullPhoto(pid);
    const link = (issue.evidence || []).find((e) => e.id === pid) || {};
    // a linked photograph that cannot be read from storage still goes, as a
    // stub with no image: the server records it as missing evidence rather
    // than analysing the issue as if the photograph never existed
    if (!p || !p.dataUrl) { photos.push({ id: pid, no: (p && p.no) || null, caption: (p && p.caption) || "", captionSource: p && p.captionAi ? "ai" : "human", linkSource: link.source || "unknown", takenAt: (p && p.takenAt) || null }); continue; }
    photos.push({ id: pid, no: p.no || null, caption: p.caption || "", captionSource: p.captionAi ? "ai" : "human", dataUrl: await aiPhotoCopy(p.dataUrl), linkSource: link.source || "unknown", takenAt: p.takenAt || null });
  }
  const memos = issueMemoIds(issue).map((mid) => {
    const m = (room.memos || []).find((x) => x.id === mid) || { id: mid };
    const t = transcripts[mid] || null;
    const link = (issue.evidence || []).find((e) => e.id === mid) || {};
    return { id: mid, secs: m.secs || null, linkSource: link.source || "unknown", transcript: t ? { text: t.text || "", status: t.status, version: t.version || 1, provider: t.provider || null } : null };
  });
  const readings = issueReadingIds(issue).map((rid) => (room.readings || []).find((r) => r.id === rid)).filter(Boolean).map((r) => ({ id: r.id, text: r.text, value: r.value, unit: r.unit }));
  return {
    requestId, snapshot,
    context: { roomName: room.name, roomOrder: order, builtPre2000: typeof inspection.builtPre2000 === "boolean" ? inspection.builtPre2000 : null, inspectedAt: inspection.startedAt ? new Date(inspection.startedAt).toISOString() : "" },
    issue: { id: issue.id, title: issue.title, description: issue.description || "", descriptionSource: issue.descriptionSource || "human_typed", humanSuspectedCause: issue.humanSuspectedCause || "", confirmedBySurveyor: !!issue.confirmedBySurveyor, createdBy: issue.createdBy || "", evidence: (issue.evidence || []).map((e) => ({ id: e.id, kind: e.kind, source: e.source })) },
    room: { name: room.name, note: noteIsHuman(room) ? room.note : "", noteSource: room.noteSource || "", hypothesis: room.hypothesis || "", condition: room.condition || "" },
    photos, memos, readings, quantityOverrides: quantityOverrides || {},
    // the last run for this issue: stages whose inputs haven't changed are
    // reused server-side; `force` names the ones to re-run anyway
    prior: prior && prior.stageHashes && prior.stages ? { stageHashes: prior.stageHashes, stages: prior.stages, models: prior.models, evidence: prior.evidence } : null,
    force: force || [],
  };
}

export async function draftIssue(caseId, roomId, issueId, body, signal) {
  const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}/rooms/${encodeURIComponent(roomId)}/issues/${encodeURIComponent(issueId)}/draft`, json(body, signal));
  if (!r.ok) throw await readError(r, "Drafting failed for this issue.");
  return r.json(); // { run, finding }
}

export async function suggestClusters(caseId, room, photos, memos, signal) {
  const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}/rooms/${encodeURIComponent(room.id)}/cluster`, json({
    room: { name: room.name, note: noteIsHuman(room) ? room.note : "", noteSource: room.noteSource || "", condition: room.condition || "" }, photos, memos,
  }, signal));
  if (!r.ok) throw await readError(r, "Couldn't suggest issues for this room.");
  return r.json(); // { issues, uncertain, roomLevel, model }
}

export async function captionRoom({ caseId, roomId, room, photos, signal }) {
  const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}/rooms/${encodeURIComponent(roomId)}/caption`, json({ room, photos }, signal));
  if (!r.ok) throw await readError(r, "Couldn't caption these photos.");
  return r.json();
}

// deterministic: the server multiplies the price book by the quantities the
// surveyor confirmed; no model involved
export async function priceWithQuantities(items, overrides) {
  const r = await fetch("/api/ai/price", json({ items, overrides }));
  if (!r.ok) throw await readError(r, "Couldn't price these items.");
  return r.json();
}

// best effort: in local mode there is nothing server-side to update; in
// accounts mode the server enforces the same state machine and answers 409
// when the phone's view is stale
let remoteReview = true; // false once the server says there is no register copy (local mode)
export async function reviewFinding(id, status, { reviewed, snapshot, reason } = {}) {
  if (!remoteReview) return { ok: true, local: true };
  try {
    const r = await fetch(`/api/ai/findings/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, reviewed: reviewed || null, snapshot: snapshot || null, reason: reason || null }) });
    if (r.status === 409) return { ok: false, ...(await r.json().catch(() => ({}))) };
    if (r.status === 404) { remoteReview = false; return { ok: true, local: true }; }
    return { ok: r.ok };
  } catch { return { ok: true, offline: true }; }
}
export async function saveTranscriptCorrection(memoId, corrected) {
  try { await fetch(`/api/ai/transcripts/${encodeURIComponent(memoId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ corrected_text: corrected }) }); } catch { /* the case doc carries it */ }
}
