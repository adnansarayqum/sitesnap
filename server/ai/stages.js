// The model-backed stages. Each is a small function: build the turn, call
// the provider (or the mock), validate the shape the schema can't, return
// the structured result. Business logic — resolution, arithmetic, gating —
// lives in reference.js and gate.js, not here.
import { MOCK, EFFORTS, AI_MODEL, AI_VERIFY_MODEL, structured } from "./provider.js";
import { EVIDENCE, CAUSATION, ANALYSIS, DRAFT, VERIFY } from "./prompts.js";
import { EVIDENCE_SCHEMA, CAUSATION_SCHEMA, analysisSchema, DRAFT_SCHEMA, VERIFY_SCHEMA } from "./schemas.js";
import { evidenceTurn, causationTurn, analysisTurn, draftTurn, verifyTurn } from "./packet.js";
import { mockEvidence, mockCausation, mockAnalysis, mockDraft, mockVerify } from "./mock.js";

// photographs per evidence call: enough to see a room, few enough that the
// reply stays well inside the output budget
export const EVIDENCE_BATCH = Number(process.env.AI_EVIDENCE_BATCH) || 10;
// photographs shown to the causation stage alongside the observations
export const CAUSATION_PHOTOS = Number(process.env.AI_CAUSATION_PHOTOS) || 16;

const cached = (text) => ({ type: "text", text, cache_control: { type: "ephemeral", ttl: "1h" } });
const plain = (text) => ({ type: "text", text });
const mockResult = (output) => ({ output, model: "mock", servedByFallback: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, durationMs: 0 });

// ---- 1. evidence normalisation --------------------------------------------------
// All of an issue's photographs are processed, in batches; the note, voice
// notes and readings ride with the first batch only. Ids are renumbered so
// the merged set is unique and in order.
export async function evidenceStage(packet, ref, { signal } = {}) {
  const batches = [];
  for (let i = 0; i < packet.photos.length; i += EVIDENCE_BATCH) batches.push(packet.photos.slice(i, i + EVIDENCE_BATCH));
  if (!batches.length) batches.push([]);
  const system = [plain(EVIDENCE), cached("# Binding rules (corrections list)\n\n" + ref.corrections)];
  const parts = [];
  const usage = [];
  let model = null, fallback = null;
  for (const [i, batch] of batches.entries()) {
    const r = MOCK ? mockResult(mockEvidence(packet, batch, i === 0)) : await structured({
      label: `evidence${batches.length > 1 ? ` ${i + 1}/${batches.length}` : ""}`, system, content: evidenceTurn(packet, batch, { first: i === 0 }),
      schema: EVIDENCE_SCHEMA, effort: EFFORTS.evidence, maxTokens: 8000, signal,
      validate: (o) => (!Array.isArray(o.observations) ? "no observations array" : null),
    });
    parts.push(r.output); usage.push(r.usage); model = r.model; fallback = fallback || r.servedByFallback;
  }
  const merged = { observations: [], statements: [], measurements: [], unreadable_sources: [], evidence_gaps: [] };
  const pad = (n) => String(n).padStart(3, "0");
  const rename = {};
  for (const p of parts) {
    for (const o of p.observations || []) { const id = `OBS-${pad(merged.observations.length + 1)}`; rename[o.id] = id; merged.observations.push({ ...o, id, source_ids: uniq(o.source_ids) }); }
    for (const s of p.statements || []) { const id = `STMT-${pad(merged.statements.length + 1)}`; rename[s.id] = id; merged.statements.push({ ...s, id, source_ids: uniq(s.source_ids) }); }
    for (const m of p.measurements || []) { const id = `MEAS-${pad(merged.measurements.length + 1)}`; rename[m.id] = id; merged.measurements.push({ ...m, id, source_ids: uniq(m.source_ids) }); }
    merged.unreadable_sources.push(...(p.unreadable_sources || []));
    merged.evidence_gaps.push(...(p.evidence_gaps || []));
  }
  merged.evidence_gaps = uniq(merged.evidence_gaps);
  return { evidence: merged, rename, usage, model, servedByFallback: fallback, batches: batches.length };
}

// ---- 2. blind causation -------------------------------------------------------------
export async function causationStage(packet, evidence, ref, { signal } = {}) {
  // show the photographs the observations actually rest on, most-cited first
  const counts = {};
  for (const o of evidence.observations) for (const s of o.source_ids) if (s.startsWith("PHOTO-")) counts[s] = (counts[s] || 0) + 1;
  const ranked = [...packet.photos].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  const shown = ranked.slice(0, CAUSATION_PHOTOS);
  const system = [plain(CAUSATION), cached("# Defect playbook\n\n" + ref.playbook + "\n\n---\n\n# Binding rules (corrections list)\n\n" + ref.corrections)];
  const r = MOCK ? mockResult(mockCausation(packet, evidence)) : await structured({
    label: "causation", system, content: causationTurn(packet, evidence, shown), schema: CAUSATION_SCHEMA, effort: EFFORTS.causation, maxTokens: 8000, signal,
    validate: (o) => (!Array.isArray(o.candidate_causes) ? "no candidate causes" : null),
  });
  return { ...r, photosShown: shown.map((p) => p.id), partialVisual: shown.length < packet.photos.length };
}

// ---- 3–6. comparison, scope, controlled selections ---------------------------------
export function controlledLists(ref) {
  return {
    legal: ref.legal.entries.map((e) => ({ id: e.id, cite: e.cite, title: e.title, covers: e.covers, applies_when: e.applies_when, not_when: e.not_when })),
    hhsrs_hazards: ref.hhsrs.hazards.map((h) => ({ id: h.id, n: h.n, name: h.name })),
    price_rows: ref.priceBook.rows.filter((r) => r.active).map((r) => ({ id: r.id, work: r.work, unit: r.unit, quantity_kind: r.qty ? r.qty.kind : "count", quantity_unit: r.qty ? r.qty.unit : r.unit, quantity_evidence: r.qty ? r.qty.evidence : "assumable", excludes: r.excludes || [], notes: r.notes || "" })),
  };
}
export async function analysisStage(packet, evidence, causation, ref, { signal } = {}) {
  const lists = controlledLists(ref);
  const schema = analysisSchema({ legalIds: lists.legal.map((l) => l.id), hazardIds: lists.hhsrs_hazards.map((h) => h.id), priceRowIds: lists.price_rows.map((r) => r.id) });
  const system = [plain(ANALYSIS), cached("# Defect playbook\n\n" + ref.playbook + "\n\n---\n\n# Binding rules (corrections list)\n\n" + ref.corrections + "\n\n---\n\n# Legal register — guidance on citing\n\n" + ref.legal.notes)];
  const r = MOCK ? mockResult(mockAnalysis(packet, evidence, causation, lists)) : await structured({
    label: "analysis", system, content: analysisTurn(packet, evidence, causation, lists), schema, effort: EFFORTS.analysis, maxTokens: 8000, signal,
    validate: (o) => (!o.comparison || !o.remedial ? "missing comparison or remedial" : null),
  });
  // "none" placeholders out of the enums
  const out = r.output;
  out.legal_refs = (out.legal_refs || []).filter((x) => x.legal_register_id && x.legal_register_id !== "none");
  out.price_items = (out.price_items || []).filter((x) => x.price_book_row_id && x.price_book_row_id !== "none");
  if (out.hhsrs && out.hhsrs.hazard_id === "none") out.hhsrs = null;
  return r;
}

// ---- 7. drafting ------------------------------------------------------------------------
export async function draftStage(packet, inputs, ref, { signal } = {}) {
  const system = [plain(DRAFT), cached("# Style examples — register and construction only\n\n" + ref.style + "\n\n---\n\n# Phrasing rules\n\n" + ref.legal.notes.split("## Statutes")[0])];
  return MOCK ? mockResult(mockDraft(packet, inputs)) : structured({
    label: "draft", system, content: draftTurn(packet, inputs), schema: DRAFT_SCHEMA, effort: EFFORTS.draft, maxTokens: 4000, signal,
    validate: (o) => (!o.defect || !o.title ? "missing defect or title" : null),
  });
}

// ---- 8. verification ----------------------------------------------------------------------
// Separate instructions, separate call, the raw sources handed over again,
// no sight of the drafter's reasoning about itself — and, where configured,
// a different model.
export async function verifyStage(packet, evidence, analysis, candidate, { signal } = {}) {
  const system = [plain(VERIFY)];
  return MOCK ? mockResult(mockVerify(packet, evidence, candidate)) : structured({
    label: "verify", system, content: verifyTurn(packet, evidence, analysis, candidate), schema: VERIFY_SCHEMA, effort: EFFORTS.verify, maxTokens: 6000, signal, model: AI_VERIFY_MODEL,
    validate: (o) => (!Array.isArray(o.claims) ? "no claims" : null),
  });
}

export { AI_MODEL };
const uniq = (a) => [...new Set((a || []).map(String))];
