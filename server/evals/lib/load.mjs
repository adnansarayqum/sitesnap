// Loads golden case files and turns each into pipeline input. One case file
// shape for every kind:
//
//   {
//     "id": "GOLDEN-A-001", "title": "…", "kind": "pipeline" | "verifier" | "deterministic",
//     "category": "text_logic" | "synthetic_multimodal" | "real_multimodal" | "control",
//     "split": "development" | "holdout", "risk": "causation" | …,
//     "status": "runnable" | "REQUIRES_REAL_SURVEY_EVIDENCE",
//     "why": "…",
//     "input": { "context": {…}, "room": {…}, "issue": {…}, "photos": […], "transcripts": […], "readings": […], "quantityOverrides": {} }
//       — or "issues": [ { …issue fields, photos, transcripts, readings, expected, must_not_happen, contamination_terms } ] for a multi-defect room
//     "expected": { … shorthand keys (see assertions.mjs EXPECTED_MAP) … },
//     "must_not_happen": [ { "rule": "…", …params, "severity": "critical" | "major" | "minor", "label": "…" } ],
//     "allowed_uncertainty": [ "prose for the reviewer" ],
//     "calibration": { "truth": "regex the correct cause matches, or null when no cause should be carried", "evidence_supports": "high" | "medium" | "low" },
//     "reviewer_notes": "…"
//   }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedToRules, validateRuleSpecs, INVARIANTS } from "./assertions.mjs";

export const EVALS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CASES_DIR = path.join(EVALS_DIR, "cases");
export const FIXTURES_DIR = path.join(EVALS_DIR, "fixtures");

export const CATEGORIES = ["text_logic", "synthetic_multimodal", "real_multimodal", "control"];
export const RISKS = ["causation", "evidence_integrity", "multi_defect", "pricing", "legal_hhsrs", "professional_caution", "prompt_injection", "eligibility", "verifier", "deterministic_control"];

const mime = (p) => ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" })[path.extname(p).toLowerCase()] || "image/jpeg";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".json") ? [path.join(dir, d.name)] : []));
}

export function loadCases({ filter = [], split = "development", categories = null } = {}) {
  const files = walk(CASES_DIR).sort();
  const cases = [];
  for (const file of files) {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    c.file = path.relative(EVALS_DIR, file);
    c.kind = c.kind || "pipeline";
    c.split = c.split || "development";
    c.status = c.status || "runnable";
    if (!c.id || !c.title) throw new Error(`${c.file}: id and title are required`);
    if (!CATEGORIES.includes(c.category)) throw new Error(`${c.file}: category must be one of ${CATEGORIES.join(", ")}`);
    if (c.risk && !RISKS.includes(c.risk)) throw new Error(`${c.file}: unknown risk "${c.risk}"`);
    if (c.category === "real_multimodal" && c.status !== "REQUIRES_REAL_SURVEY_EVIDENCE") throw new Error(`${c.file}: real_multimodal cases must be marked REQUIRES_REAL_SURVEY_EVIDENCE until genuine photographs exist`);
    // rule specs are checked at load so a typo fails loudly, never as a silent pass
    for (const unit of c.input && c.input.issues ? c.input.issues : [c]) {
      if (c.kind === "pipeline") { validateRuleSpecs(expectedToRules(unit.expected), `${c.file} expected`); validateRuleSpecs(unit.must_not_happen || [], `${c.file} must_not_happen`); }
    }
    if (filter.length && !filter.some((s) => c.id.toLowerCase().includes(s.toLowerCase()) || c.file.toLowerCase().includes(s.toLowerCase()))) continue;
    if (split !== "all" && c.split !== split) continue;
    if (categories && !categories.includes(c.category)) continue;
    cases.push(c);
  }
  return cases;
}

// photos: "fixtures/x.png" | { file, caption, captionSource, linkSource, no, missing }
export function loadPhotos(list, idPrefix = "ph") {
  const out = [];
  (list || []).forEach((entry, i) => {
    const e = typeof entry === "string" ? { file: entry } : entry;
    const abs = path.resolve(EVALS_DIR, e.file || "");
    const exists = !!e.file && fs.existsSync(abs);
    const photo = { id: e.id || `${idPrefix}_${i + 1}`, no: e.no || i + 1, caption: e.caption || "", captionSource: e.captionSource === "ai" ? "ai" : "human", linkSource: e.linkSource || "capture_session", takenAt: e.takenAt || null };
    // a link whose file cannot be read is kept as a link (the app would have
    // one too) but carries no image — the case decides what that should mean
    if (exists) photo.dataUrl = `data:${mime(abs)};base64,${fs.readFileSync(abs).toString("base64")}`;
    else photo.missing = true;
    out.push(photo);
  });
  return out;
}

export function loadMemos(list, idPrefix = "m") {
  return (list || []).map((t, k) => {
    const o = typeof t === "string" ? { text: t } : t;
    const status = o.status || "complete";
    return { id: o.id || `${idPrefix}_${k + 1}`, secs: o.secs || null, linkSource: o.linkSource || "capture_session", transcript: status === "unavailable" ? null : { text: o.text || "", status, version: o.version || (status === "corrected" ? 2 : 1), provider: "eval" } };
  });
}

// one issue (the case's single issue, or one of a multi-defect room) → pipeline input
export function toPipelineInput(c, unit = null) {
  const i = c.input || {};
  const u = unit || i;
  const room = i.room || {};
  const ctx = i.context || {};
  const prefix = unit ? unit.id || "iss" : "iss";
  const photos = loadPhotos(u.photos, `${prefix}_ph`);
  const memos = loadMemos(u.transcripts, `${prefix}_m`);
  const readings = (u.readings || []).map((r, k) => ({ id: r.id || `${prefix}_rd_${k + 1}`, text: r.text || "", value: r.value, unit: r.unit || "" }));
  const src = u.issue || (unit ? unit : {});
  const issue = {
    id: src.id || (unit ? `iss_${prefix}` : "iss_eval0001"),
    title: src.title || room.name || "Issue",
    description: src.description || "",
    descriptionSource: src.descriptionSource || "human_typed",
    humanSuspectedCause: src.humanSuspectedCause != null ? src.humanSuspectedCause : (unit ? "" : room.hypothesis || ""),
    confirmedBySurveyor: src.confirmedBySurveyor !== undefined ? !!src.confirmedBySurveyor : true,
    createdBy: src.createdBy || "surveyor",
    evidence: [
      ...photos.map((p) => ({ id: p.id, kind: "photo", source: p.linkSource })),
      ...memos.map((m) => ({ id: m.id, kind: "memo", source: m.linkSource })),
      ...readings.map((r) => ({ id: r.id, kind: "reading", source: "capture_session" })),
    ],
  };
  const noteSource = room.noteSource || "human_typed";
  return {
    requestId: undefined, snapshot: `eval:${c.id}`,
    context: { roomName: room.name || "Room", roomOrder: room.order || null, roomCondition: room.condition || "", builtPre2000: typeof ctx.builtPre2000 === "boolean" ? ctx.builtPre2000 : null, inspectedAt: ctx.inspectedAt || "" },
    issue,
    room: { name: room.name || "Room", note: room.note || "", noteSource, hypothesis: room.hypothesis || "", condition: room.condition || "" },
    note: room.note ? { text: room.note, source: noteSource } : null,
    roomHypothesis: room.hypothesis || "",
    // the packet ignores anything without an image, exactly as the server does
    photos: photos.filter((p) => p.dataUrl),
    memos, readings,
    quantityOverrides: u.quantityOverrides || i.quantityOverrides || {},
    _missingPhotos: photos.filter((p) => p.missing).map((p) => p.id),
  };
}

// the rule specs one unit is judged by: its expected shorthand, its
// must_not_happen list, and the suite-wide invariants
export function rulesFor(unit, { withInvariants = true } = {}) {
  const own = [...expectedToRules(unit.expected), ...(unit.must_not_happen || []).map((m) => ({ ...m, severity: m.severity || "major", label: m.label || m.rule }))];
  return withInvariants ? [...own, ...INVARIANTS] : own;
}
