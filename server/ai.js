// Façade over the AI service (server/ai/*). Routes, the boot log and the
// evals import from here; the provider boundary, prompts, schemas, stages,
// pipeline and mocks live in the directory.
export { aiEnabled, transcriptionEnabled, withConnectionRetry, AI_MODEL, AI_VERIFY_MODEL, AI_EFFORT, AI_CAPTION_EFFORT, EFFORTS, MOCK } from "./ai/provider.js";
export { runIssuePipeline, PIPELINE_VERSION } from "./ai/pipeline.js";
export { captionRoomPhotos } from "./ai/captions.js";
export { transcribeAudio, TRANSCRIBE_MODEL } from "./ai/transcription.js";
export { suggestClusters } from "./ai/cluster.js";
export { loadReference, priceItems, resolveLegal, resolveHazard, referenceFingerprints } from "./reference.js";
export { PROMPT_HASHES } from "./ai/prompts.js";

// ---- workbook export ------------------------------------------------------------
// The Scott Schedule columns the firm's Excel macro reads, one row per
// approved finding. Shared by the server (evals) and the client (export).
export const SCHEDULE_COLUMNS = ["Item", "Location", "Defect", "Cause", "Legislation", "HHSRS", "Remedial works", "Scope", "Conditions", "Price low", "Price high", "Price basis", "Photos", "Confidence"];
export function scheduleRows(findingsByRoom) {
  const rows = [];
  let n = 0;
  for (const { room, findings } of findingsByRoom) {
    for (const f of findings) {
      n += 1;
      rows.push([
        n, `${room} — ${f.location}`, f.defect, f.assessment.likely_cause, f.legislation.join("; "), f.hhsrs_hazard,
        f.remedial.works, f.remedial.scope, (f.remedial.conditions || []).join("; "),
        f.cost.unpriced ? "" : f.cost.low, f.cost.unpriced ? "" : f.cost.high, f.cost.basis,
        (f.photo_refs || []).map((p) => `Photo ${p}`).join(", "), f.confidence,
      ]);
    }
  }
  return rows;
}
export function toCsv(rows) {
  const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [SCHEDULE_COLUMNS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
