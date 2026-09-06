// The phone's side of the AI step (server/ai.js, server/ai-routes.js).
//
// Findings live in the case itself — `inspection.findings` — so they work
// offline, ride along on the register sync like everything else, and survive
// the server having no database. Shape:
//
//   { runs:  { [roomId]: { id, at, model, room_summary, evidence_gaps, transcripts, photos } },
//     items: [ { id, roomId, roomName, seq, status, reviewed?, ...finding } ] }
//
// `status` is the surveyor's decision: draft | approved | edited | rejected.
// `reviewed` holds their edits (defect, works, cost) — the AI's original is
// never overwritten, so an eval can compare the two.
import { drawScaled, loadImage } from "./lib/image.js";

// Claude reads images best at or under ~1568px on the long edge; the stored
// copy is 2200px, so the AI copy is re-encoded from it — smaller request,
// same evidence.
export const AI_DIM = 1568;

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
  return e;
}

export async function transcribeMemo(caseId, roomId, memo, blob) {
  const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}/rooms/${encodeURIComponent(roomId)}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": blob.type || memo.type || "audio/webm", "x-memo-id": memo.id, "x-filename": `note.${(memo.type || "audio/webm").split("/")[1].split(";")[0]}` },
    body: blob,
  });
  if (!r.ok) throw await readError(r, "Couldn't transcribe this voice note.");
  return (await r.json()).text || "";
}

export async function draftRoom({ inspection, room, order, transcripts, photos }) {
  const r = await fetch(`/api/ai/cases/${encodeURIComponent(inspection.id)}/rooms/${encodeURIComponent(room.id)}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: {
        address: inspection.address, postcode: inspection.postcode || "", reference: inspection.ref || "",
        client: inspection.client || "", inspectedAt: inspection.startedAt ? new Date(inspection.startedAt).toISOString() : "",
      },
      room: { name: room.name, order, condition: room.condition || "", note: room.note || "", hypothesis: room.hypothesis || "" },
      transcripts, photos,
    }),
  });
  if (!r.ok) throw await readError(r, "Drafting failed for this room.");
  return r.json();
}

// best effort: in local mode there is nothing server-side to update
export async function reviewFinding(id, status, reviewed) {
  try {
    await fetch(`/api/ai/findings/${encodeURIComponent(id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, reviewed: reviewed || null }),
    });
  } catch { /* the case doc carries the decision regardless */ }
}

// ---- the findings state kept in the case --------------------------------------
export const emptyFindings = () => ({ runs: {}, items: [] });

export function mergeRun(state, room, res) {
  const s = state && state.items ? state : emptyFindings();
  const items = s.items.filter((f) => f.roomId !== room.id);
  for (const f of res.findings) items.push({ ...f, roomId: room.id, roomName: room.name });
  return {
    runs: { ...s.runs, [room.id]: { id: res.run.id, at: Date.now(), model: res.run.model, servedByFallback: res.run.servedByFallback || null, reference: res.run.reference, room_summary: res.room_summary, evidence_gaps: res.evidence_gaps || [], usage: res.run.usage || null } },
    items: items.sort((a, b) => (a.roomName === b.roomName ? a.seq - b.seq : 0)),
  };
}

export function setFindingStatus(state, id, status, reviewed) {
  return { ...state, items: state.items.map((f) => (f.id === id ? { ...f, status, reviewed: reviewed === undefined ? f.reviewed : reviewed, reviewedAt: Date.now() } : f)) };
}

// what the report and the workbook see: the surveyor's edits over the draft
export function effective(f) {
  if (!f.reviewed) return f;
  const r = f.reviewed;
  return {
    ...f,
    defect: r.defect ?? f.defect,
    remedial: { ...f.remedial, works: r.works ?? f.remedial.works },
    cost: { ...f.cost, low: r.costLow ?? f.cost.low, high: r.costHigh ?? f.cost.high, unpriced: r.costLow != null ? false : f.cost.unpriced },
    legislation: r.legislation ?? f.legislation,
  };
}

export const isApproved = (f) => f.status === "approved" || f.status === "edited";
export const needsAttention = (f) => (f.review_flags || []).length > 0 || (f.assessment && (f.assessment.agreement === "disagree" || f.assessment.agreement === "uncertain"));

export function approvedByRoom(state, rooms) {
  if (!state || !state.items) return [];
  return rooms.map((r) => ({ room: r.name, roomId: r.id, findings: state.items.filter((f) => f.roomId === r.id && isApproved(f)).map(effective) })).filter((r) => r.findings.length);
}

// The old cloud-workflow shape (docs/cloud-workflow.md) still arrives when a
// Make/n8n scenario replies with findings; lift it into the new shape with the
// fields it lacks marked for review.
export function fromLegacyDraft(json, rooms) {
  if (!json || !Array.isArray(json.rooms)) return null;
  const state = emptyFindings();
  for (const lr of json.rooms) {
    const room = rooms.find((r) => r.name === lr.room_name) || { id: `legacy_${lr.room_name}`, name: lr.room_name };
    (lr.findings || []).forEach((f, i) => {
      state.items.push({
        id: `legacy_${room.id}_${i}`, roomId: room.id, roomName: room.name, seq: i + 1, status: "draft",
        title: f.defect.slice(0, 60), location: room.name, defect: f.defect, photo_refs: [], surveyor_hypothesis: "",
        assessment: { likely_cause: "", agreement: "no_hypothesis", reasoning: "Drafted by the cloud workflow, not by SiteSnap's own step — no photo assessment.", alternative_causes: [] },
        legislation: f.legislation_breached ? [f.legislation_breached] : [], hhsrs_hazard: "",
        remedial: { works: f.remedial_action, scope: "localised", scope_rationale: "", conditions: [] },
        cost: { low: 0, high: 0, currency: "GBP", basis: "", price_book_refs: [], unpriced: true },
        confidence: f.confidence === "high" ? "high" : "low", review_flags: ["unpriced", "no_photo_evidence"],
      });
    });
    state.runs[room.id] = { id: "legacy", at: Date.now(), model: "cloud workflow", room_summary: "", evidence_gaps: [] };
  }
  return state;
}

// ---- Scott Schedule export -------------------------------------------------------
// Same columns as server/ai.js so evals and exports agree.
export const SCHEDULE_COLUMNS = ["Item", "Location", "Defect", "Cause", "Legislation", "HHSRS", "Remedial works", "Scope", "Conditions", "Price low", "Price high", "Price basis", "Photos", "Confidence"];
export function scheduleRows(byRoom) {
  const rows = []; let n = 0;
  for (const { room, findings } of byRoom) {
    for (const f of findings) {
      n += 1;
      rows.push([n, `${room} — ${f.location}`, f.defect, f.assessment.likely_cause, f.legislation.join("; "), f.hhsrs_hazard,
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
  const json = new File([JSON.stringify({ exported: new Date().toISOString(), rooms: byRoom }, null, 2)], "draft-findings.json", { type: "application/json" });
  return [csv, json];
}
