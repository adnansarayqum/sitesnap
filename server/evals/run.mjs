#!/usr/bin/env node
// Runs the drafting step against the golden cases in ./cases and scores the
// output against what the surveyor expects. Every rule in
// server/reference/corrections.md should have a case here that fails
// without it — that is what makes the corrections list testable rather than
// a list of hopes.
//
//   node server/evals/run.mjs                 # all cases, real model (needs ANTHROPIC_API_KEY)
//   node server/evals/run.mjs ceiling         # cases whose file name contains "ceiling"
//   AI_MOCK=1 node server/evals/run.mjs       # exercises the harness only; scores are not meaningful
//   node server/evals/run.mjs --json out.json # also write every draft for reading side by side
//
// A case file:
//   { "name": "...", "why": "...",
//     "input":  { "context": {...}, "room": {...}, "transcripts": [...], "photos": ["relative/path.jpg", ...] },
//     "expect": { "agreement_in": [...], "legislation_includes": [...], "scope": "...", "flags_include": [...],
//                 "price_refs_include": [...], "cost_min": n, "cost_max": n, "works_must_contain": [...],
//                 "works_must_not_contain": [...], "alternatives_min": n, "findings_min": n } }
// Every key in `expect` is optional; each one present is one check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { draftRoomFindings, AI_MODEL } from "../ai.js";

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
    return { id: `ph_${i}`, no: typeof entry === "object" && entry.no ? entry.no : i + 1, caption: typeof entry === "object" ? entry.caption || "" : "", dataUrl: `data:${mime(abs)};base64,${fs.readFileSync(abs).toString("base64")}` };
  }).filter(Boolean);
}

const lower = (s) => String(s || "").toLowerCase();
function score(expect, out) {
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const findings = out.findings || [];
  const f = findings[0];
  if (expect.findings_min != null) ok(`findings ≥ ${expect.findings_min}`, findings.length >= expect.findings_min, `${findings.length}`);
  if (!f) { for (const k of Object.keys(expect)) if (k !== "findings_min") ok(k, false, "no finding"); return checks; }
  const allWorks = findings.map((x) => lower(x.remedial.works) + " " + lower(x.remedial.scope_rationale)).join(" | ");
  const allLeg = findings.flatMap((x) => x.legislation);
  const allFlags = findings.flatMap((x) => x.review_flags || []);
  const allRefs = findings.flatMap((x) => x.cost.price_book_refs || []);
  const allConds = findings.flatMap((x) => x.remedial.conditions || []).map(lower).join(" | ");
  if (expect.agreement_in) ok(`agreement in [${expect.agreement_in}]`, expect.agreement_in.includes(f.assessment.agreement), f.assessment.agreement);
  if (expect.legislation_includes) for (const l of expect.legislation_includes) ok(`legislation includes ${l}`, allLeg.some((x) => lower(x).includes(lower(l))), allLeg.join(", ") || "(none)");
  if (expect.scope) ok(`scope = ${expect.scope}`, findings.some((x) => x.remedial.scope === expect.scope), findings.map((x) => x.remedial.scope).join(", "));
  if (expect.flags_include) for (const fl of expect.flags_include) ok(`flag ${fl}`, allFlags.includes(fl) || (fl === "asbestos" && /asbestos/.test(allConds)), allFlags.join(", ") || "(none)");
  if (expect.price_refs_include) for (const r of expect.price_refs_include) ok(`price ref ${r}`, allRefs.includes(r), allRefs.join(", ") || "(none)");
  if (expect.cost_min != null) ok(`total cost high ≥ £${expect.cost_min}`, findings.reduce((s, x) => s + (x.cost.unpriced ? 0 : x.cost.high), 0) >= expect.cost_min, `£${findings.reduce((s, x) => s + (x.cost.unpriced ? 0 : x.cost.high), 0)}`);
  if (expect.cost_max != null) ok(`total cost low ≤ £${expect.cost_max}`, findings.reduce((s, x) => s + (x.cost.unpriced ? 0 : x.cost.low), 0) <= expect.cost_max, `£${findings.reduce((s, x) => s + (x.cost.unpriced ? 0 : x.cost.low), 0)}`);
  if (expect.works_must_contain) for (const w of expect.works_must_contain) ok(`works mention "${w}"`, allWorks.includes(lower(w)), "");
  if (expect.works_must_not_contain) for (const w of expect.works_must_not_contain) ok(`works avoid "${w}"`, !allWorks.includes(lower(w)), "");
  if (expect.alternatives_min != null) ok(`alternative causes ≥ ${expect.alternatives_min}`, findings.some((x) => (x.assessment.alternative_causes || []).length >= expect.alternatives_min), "");
  if (expect.defect_must_contain) for (const w of expect.defect_must_contain) ok(`defect mentions "${w}"`, findings.some((x) => lower(x.defect).includes(lower(w))), "");
  return checks;
}

console.log(`drafting: ${mock ? "AI_MOCK (harness check only — scores mean nothing)" : AI_MODEL}\n`);
const results = [];
let passed = 0, totalChecks = 0, usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
for (const file of files) {
  const c = JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));
  const input = { ...c.input, photos: loadPhotos(c.input.photos, casesDir) };
  const t0 = Date.now();
  let res, err;
  try { res = await draftRoomFindings(input); } catch (e) { err = e; }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`▸ ${c.name}  (${file}, ${input.photos.length} photo${input.photos.length === 1 ? "" : "s"}, ${secs}s)`);
  if (c.why) console.log(`  why: ${c.why}`);
  if (err) { console.log(`  ✗ drafting failed: ${err.message}\n`); results.push({ file, name: c.name, error: err.message }); continue; }
  const checks = score(c.expect || {}, res.output);
  for (const ch of checks) { totalChecks += 1; if (ch.pass) passed += 1; console.log(`  ${ch.pass ? "✓" : "✗"} ${ch.name}${ch.detail ? `  — ${ch.detail}` : ""}`); }
  for (const k of Object.keys(usage)) usage[k] += res.usage[k] || 0;
  console.log("");
  results.push({ file, name: c.name, checks, output: res.output, model: res.model, usage: res.usage });
}
console.log(`${passed}/${totalChecks} checks passed · tokens in ${usage.input} (cache read ${usage.cacheRead}, write ${usage.cacheWrite}) · out ${usage.output}`);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2)); console.log(`drafts written to ${jsonOut}`); }
process.exit(mock ? 0 : passed === totalChecks ? 0 : 1);
