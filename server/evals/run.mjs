#!/usr/bin/env node
// Runs the staged pipeline against the golden cases in ./cases and scores
// the finding against what the surveyor expects. Every rule in
// server/reference/corrections.md should have a case here that fails
// without it — that is what makes the corrections list testable rather than
// a list of hopes.
//
//   node server/evals/run.mjs                 # all cases, real model (needs ANTHROPIC_API_KEY)
//   node server/evals/run.mjs ceiling         # cases whose file name contains "ceiling"
//   AI_MOCK=1 node server/evals/run.mjs       # exercises the harness only; scores are not meaningful
//   node server/evals/run.mjs --json out.json # also write every run record for reading side by side
//
// A case file (the pre-2.0 room-level shape is still accepted: it becomes
// one confirmed issue holding every photo and transcript):
//   { "name": "...", "why": "...",
//     "input":  { "context": {...}, "room": {...}, "issue": {...}?, "transcripts": [...], "photos": ["relative/path.jpg", ...] },
//     "expect": { "agreement_in": [...], "legislation_includes": [...], "scope": "...", "flags_include": [...],
//                 "price_refs_include": [...], "cost_min": n, "cost_max": n, "works_must_contain": [...],
//                 "works_must_not_contain": [...], "alternatives_min": n, "gate": "...", "defect_must_contain": [...] } }
// Every key in `expect` is optional; each one present is one check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIssuePipeline, AI_MODEL } from "../ai.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const filter = args.filter((a) => !a.startsWith("--") && a !== jsonOut);
const mock = process.env.AI_MOCK === "1";

const files = fs.readdirSync(casesDir).filter((f) => f.endsWith(".json")).filter((f) => !filter.length || filter.some((s) => f.includes(s))).sort();
if (!files.length) { console.error("no cases matched"); process.exit(2); }

const mime = (p) => ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" })[path.extname(p).toLowerCase()] || "image/jpeg";
function loadPhotos(list, base) {
  return (list || []).map((entry, i) => {
    const rel = typeof entry === "string" ? entry : entry.path;
    const abs = path.resolve(base, rel);
    if (!fs.existsSync(abs)) return null;
    return { id: `ph_${i}`, no: typeof entry === "object" && entry.no ? entry.no : i + 1, caption: typeof entry === "object" ? entry.caption || "" : "", captionSource: "human", dataUrl: `data:${mime(abs)};base64,${fs.readFileSync(abs).toString("base64")}`, linkSource: "capture_session" };
  }).filter(Boolean);
}

// the pre-2.0 case shape → one confirmed issue with everything linked
function toPipelineInput(c) {
  const i = c.input;
  const photos = loadPhotos(i.photos, casesDir);
  const memos = (i.transcripts || []).map((t, k) => ({ id: `m_${k}`, secs: null, linkSource: "capture_session", transcript: { text: t, status: "complete", version: 1, provider: "eval" } }));
  const issue = i.issue || { id: "iss_eval0001", title: i.room.name, description: "", descriptionSource: "human_typed", humanSuspectedCause: i.room.hypothesis || "", confirmedBySurveyor: true, createdBy: "surveyor" };
  issue.evidence = [...photos.map((p) => ({ id: p.id, kind: "photo", source: "capture_session" })), ...memos.map((m) => ({ id: m.id, kind: "memo", source: "capture_session" }))];
  return {
    requestId: undefined, snapshot: "eval",
    context: { roomName: i.room.name, roomOrder: i.room.order || null, roomCondition: i.room.condition || "", builtPre2000: typeof i.context.builtPre2000 === "boolean" ? i.context.builtPre2000 : null, inspectedAt: i.context.inspectedAt || "" },
    issue, room: { name: i.room.name, note: i.room.note || "", noteSource: "human_typed", hypothesis: i.room.hypothesis || "", condition: i.room.condition || "" },
    note: i.room.note ? { text: i.room.note, source: "human_typed" } : null, roomHypothesis: i.room.hypothesis || "",
    photos, memos, readings: i.readings || [],
  };
}

const lower = (s) => String(s || "").toLowerCase();
function score(expect, f) {
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  if (!f) { for (const k of Object.keys(expect)) ok(k, false, "no finding"); return checks; }
  const works = lower(f.remedial.works) + " " + lower(f.remedial.scope_rationale);
  const conds = (f.remedial.conditions || []).map(lower).join(" | ");
  if (expect.findings_min != null) ok(`findings ≥ ${expect.findings_min}`, 1 >= expect.findings_min, "1 (one finding per issue)");
  if (expect.gate) ok(`gate = ${expect.gate}`, f.gate.status === expect.gate, f.gate.status);
  if (expect.agreement_in) ok(`agreement in [${expect.agreement_in}]`, expect.agreement_in.includes(f.assessment.agreement), f.assessment.agreement);
  if (expect.legislation_includes) for (const l of expect.legislation_includes) ok(`legislation includes ${l}`, f.legislation.some((x) => lower(x).includes(lower(l))), f.legislation.join(", ") || "(none)");
  if (expect.scope) ok(`scope = ${expect.scope}`, f.remedial.scope === expect.scope, f.remedial.scope);
  if (expect.flags_include) for (const fl of expect.flags_include) ok(`flag ${fl}`, (f.review_flags || []).includes(fl) || (fl === "asbestos" && /asbestos/.test(conds)), (f.review_flags || []).join(", ") || "(none)");
  if (expect.price_refs_include) for (const r of expect.price_refs_include) ok(`price ref ${r}`, (f.cost.price_book_refs || []).includes(r) || (f.cost.lines || []).some((l) => l.row_id === r), (f.cost.price_book_refs || []).join(", ") || "(none)");
  if (expect.cost_min != null) ok(`cost high ≥ £${expect.cost_min}`, !f.cost.unpriced && f.cost.high >= expect.cost_min, f.cost.unpriced ? "unpriced" : `£${f.cost.high}`);
  if (expect.cost_max != null) ok(`cost low ≤ £${expect.cost_max}`, !f.cost.unpriced && f.cost.low <= expect.cost_max, f.cost.unpriced ? "unpriced" : `£${f.cost.low}`);
  if (expect.works_must_contain) for (const w of expect.works_must_contain) ok(`works mention "${w}"`, works.includes(lower(w)), "");
  if (expect.works_must_not_contain) for (const w of expect.works_must_not_contain) ok(`works avoid "${w}"`, !works.includes(lower(w)), "");
  if (expect.alternatives_min != null) ok(`alternative causes ≥ ${expect.alternatives_min}`, (f.assessment.alternative_causes || []).length >= expect.alternatives_min, String((f.assessment.alternative_causes || []).length));
  if (expect.defect_must_contain) for (const w of expect.defect_must_contain) ok(`defect mentions "${w}"`, lower(f.defect).includes(lower(w)), "");
  // always: every cited source exists, the verifier ran, the gate decided
  ok("every observation cites a known source", (f.evidence.observations || []).every((o) => o.source_ids.every((s) => f.evidence.sources[s] || /^(OBS|STMT|MEAS)-/.test(s))), "");
  ok("verification produced claims", (f.verification.claims || []).length > 0, String((f.verification.claims || []).length));
  return checks;
}

console.log(`pipeline: ${mock ? "AI_MOCK (harness check only — scores mean nothing)" : AI_MODEL}\n`);
const results = [];
let passed = 0, totalChecks = 0, usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
for (const file of files) {
  const c = JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));
  const input = toPipelineInput(c);
  const t0 = Date.now();
  let res, err;
  try { res = await runIssuePipeline(input); } catch (e) { err = e; }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`▸ ${c.name}  (${file}, ${input.photos.length} photo${input.photos.length === 1 ? "" : "s"}, ${secs}s)`);
  if (c.why) console.log(`  why: ${c.why}`);
  if (err) { console.log(`  ✗ pipeline failed: ${err.message}\n`); results.push({ file, name: c.name, error: err.message }); continue; }
  const checks = score(c.expect || {}, res.finding);
  for (const ch of checks) { totalChecks += 1; if (ch.pass) passed += 1; console.log(`  ${ch.pass ? "✓" : "✗"} ${ch.name}${ch.detail ? `  — ${ch.detail}` : ""}`); }
  console.log(`  gate ${res.finding.gate.status} · confidence ${res.finding.confidence} · flags ${(res.finding.review_flags || []).join(", ") || "none"} · reused ${(res.run.reused || []).join(", ") || "none"}`);
  for (const k of Object.keys(usage)) usage[k] += res.run.usage[k] || 0;
  console.log("");
  results.push({ file, name: c.name, checks, finding: res.finding, run: res.run });
}
console.log(`${passed}/${totalChecks} checks passed · tokens in ${usage.input} (cache read ${usage.cacheRead}, write ${usage.cacheWrite}) · out ${usage.output}`);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2)); console.log(`runs written to ${jsonOut}`); }
process.exit(mock ? 0 : passed === totalChecks ? 0 : 1);
