#!/usr/bin/env node
// Adversarial golden evaluation of the findings pipeline.
//
// The question this suite answers is not "does the model write nicely" but
// "how often can it reach a materially wrong professional conclusion with
// unjustified confidence — and which control, if any, stops that becoming an
// approved finding". Every case carries things that MUST NOT happen; the
// report counts critical failures, material-wrong-and-confident outcomes,
// verifier and gate catch rates, and confidence calibration. No averages.
//
//   node server/evals/run.mjs                        development split, real model (needs ANTHROPIC_API_KEY)
//   node server/evals/run.mjs --holdout              holdout split only — do not read these while tuning prompts
//   node server/evals/run.mjs --all                  both splits
//   node server/evals/run.mjs --category text_logic,control
//   node server/evals/run.mjs GOLDEN-A-00            cases whose id or path contains the string
//   AI_MOCK=1 node server/evals/run.mjs              harness + deterministic controls only; model numbers mean nothing
//   node server/evals/run.mjs --json runs.json       also dump every finding and run record
//   node server/evals/run.mjs --verbose              print every assertion, not just failures
//
// Reports (JSON + Markdown) are written to server/evals/results/ (git-ignored).
// Case format: see lib/load.mjs. Rules: see lib/assertions.mjs. Policy: README.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIssuePipeline, AI_MODEL, AI_VERIFY_MODEL, EFFORTS, MOCK, PIPELINE_VERSION, PROMPT_HASHES, loadReference, priceItems, resolveLegal, resolveHazard } from "../ai.js";
import { buildPacket } from "../ai/packet.js";
import { evidenceStage, causationStage, analysisStage, verifyStage } from "../ai/stages.js";
import { computeConfidence, validateIds, decideGate } from "../ai/gate.js";
import { sumUsage } from "../ai/provider.js";
import { loadCases, toPipelineInput, rulesFor, EVALS_DIR } from "./lib/load.mjs";
import { evaluate, RULES } from "./lib/assertions.mjs";
import { summarise, toMarkdown, classifyUnit, safetyChain, calibration } from "./lib/report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(here, "results");

function parseArgs(argv) {
  const o = { filter: [], split: "development", categories: null, json: null, verbose: false, quiet: false, reportDir: RESULTS_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--holdout") o.split = "holdout";
    else if (a === "--all") o.split = "all";
    else if (a === "--category") o.categories = String(argv[++i] || "").split(",").filter(Boolean);
    else if (a === "--json") o.json = argv[++i];
    else if (a === "--report-dir") o.reportDir = argv[++i];
    else if (a === "--verbose") o.verbose = true;
    else if (a === "--quiet") o.quiet = true;
    else if (!a.startsWith("--")) o.filter.push(a);
  }
  return o;
}

const uniq = (a) => [...new Set(a)];
const ownSourceIds = (input) => {
  const ids = ["NOTE-1", "DESC-1", "HYP-1"];
  input.photos.forEach((p) => { ids.push(`PHOTO-${p.no}`); ids.push(`CAPTION-${p.no}`); });
  input.memos.forEach((_, i) => ids.push(`MEMO-${i + 1}`));
  input.readings.forEach((_, i) => ids.push(`READING-${i + 1}`));
  return ids;
};

// ---- kind: pipeline -------------------------------------------------------------------
async function runPipelineCase(c, ref, opts) {
  const units = c.input && c.input.issues ? c.input.issues : [c];
  const out = [];
  for (const unit of units) {
    const multi = units.length > 1 ? unit : null;
    const input = toPipelineInput(c, multi);
    const rules = rulesFor(unit);
    if (multi) {
      // cross-defect isolation: the finding may only rest on, and cite, this issue's own evidence
      rules.push({ rule: "photo_refs_subset", exhibits: input.photos.map((p) => p.no), severity: "critical", label: "cites only this issue's exhibits" });
      rules.push({ rule: "sources_subset", ids: ownSourceIds(input), severity: "critical", label: "rests only on this issue's evidence" });
      // `contamination_terms` on an issue = words that belong to its siblings' defects and must not appear in ITS finding
      if (unit.contamination_terms) rules.push({ rule: "text_not_matches", pattern: unit.contamination_terms, severity: "critical", label: "no wording belonging to a sibling issue's defect" });
    }
    const t0 = Date.now();
    let res = null, error = null;
    try { res = await runIssuePipeline(input, { prior: null }); } catch (e) { error = e; }
    const ctx = { finding: res && res.finding, run: res && res.run, error, input, ref, caseDef: c };
    const checks = rules.map((r) => evaluate(r, ctx));
    out.push({
      kind: "pipeline", id: multi ? `${c.id}/${unit.id || unit.title}` : c.id, title: multi ? unit.title : c.title,
      finding: ctx.finding, run: ctx.run, error: error ? { code: error.code, status: error.status, message: error.message } : null,
      expectedError: rules.some((r) => r.rule === "eligibility_rejected"),
      checks, calibration: unit.calibration || c.calibration || null, secs: ((Date.now() - t0) / 1000).toFixed(1),
      missingPhotos: input._missingPhotos,
    });
  }
  return out;
}

// ---- kind: verifier — a deliberately flawed candidate draft -----------------------------
// Stages can be supplied as fixtures (cheap, deterministic) or run through the
// model; the verifier and the deterministic gate always run for real (or mock).
async function runVerifierCase(c, ref) {
  const input = toPipelineInput(c);
  const packet = buildPacket(input);
  const fx = c.fixture || {};
  const usage = [];
  const evidence = fx.evidence || (await (async () => { const r = await evidenceStage(packet, ref); usage.push(...r.usage); return r.evidence; })());
  const causation = fx.causation || (await (async () => { const r = await causationStage(packet, evidence, ref); usage.push(r.usage); return r.output; })());
  const analysis = fx.analysis || (await (async () => { const r = await analysisStage(packet, evidence, causation, ref); usage.push(r.usage); return r.output; })());
  const legal = resolveLegal(ref, analysis.legal_refs);
  const hazard = resolveHazard(ref, analysis.hhsrs);
  if (hazard.rejected) legal.rejected.push(hazard.rejected);
  const pricing = priceItems(ref, analysis.price_items, {});
  const candidate = c.candidate;
  const ve = await verifyStage(packet, evidence, { causation, analysis }, candidate);
  usage.push(ve.usage);
  const idProblems = validateIds(packet, evidence, analysis, candidate);
  const confidence = computeConfidence({ evidence, causation, verification: ve.output, packet, pricing });
  const gate = decideGate({ packet, evidence, causation, analysis, legal, pricing, verification: ve.output, idProblems, confidence });
  // the same gate with the verifier silenced: what the deterministic rules catch alone
  const gateDet = decideGate({ packet, evidence, causation, analysis, legal, pricing, verification: { claims: [] }, idProblems, confidence });
  const claims = ve.output.claims || [];
  const flaws = (c.flaws || []).map((f) => {
    const hit = claims.find((k) => new RegExp(f.pattern, "i").test(`${k.claim} ${k.note}`) && (!f.type_in || f.type_in.includes(k.type)) && (f.support_in || ["unsupported", "contradicted"]).includes(k.support));
    const caughtByGate = gateDet.status === "blocked" && (!f.deterministic_reason || gateDet.reasons.some((r) => new RegExp(f.deterministic_reason, "i").test(r)));
    return { caseId: c.id, label: f.label, severity: f.severity || "critical", detectedByVerifier: !!hit, caughtByGate, claim: hit ? `${hit.type}/${hit.support}: ${hit.claim.slice(0, 120)}` : null };
  });
  const checks = flaws.map((f) => ({ rule: "flaw_caught", label: f.label, severity: f.severity, pass: f.detectedByVerifier || f.caughtByGate, detail: f.detectedByVerifier ? `verifier: ${f.claim}` : f.caughtByGate ? `deterministic gate: ${gateDet.reasons.join("; ")}` : "missed by verifier and gate" }));
  checks.push({ rule: "gate_blocked", label: "the flawed draft is blocked", severity: "critical", pass: gate.status === "blocked", detail: `gate ${gate.status}${gate.reasons.length ? `: ${gate.reasons.join("; ")}` : ""}` });
  return [{ kind: "verifier", id: c.id, title: c.title, checks, flaws, gate, gateDet, claims, usage: sumUsage(usage), error: null }];
}

// ---- kind: deterministic — the server-side controls, exercised directly -------------------
function runDeterministicCase(c, baseRef) {
  const ref = structuredClone(baseRef);
  for (const id of (c.ref_overrides && c.ref_overrides.inactive) || []) { if (ref.priceBook.byId[id]) ref.priceBook.byId[id].active = false; const row = ref.priceBook.rows.find((r) => r.id === id); if (row) row.active = false; }
  const e = c.expected || {};
  const checks = [];
  const ok = (label, pass, detail) => checks.push({ rule: `control:${c.control}`, label, severity: "critical", pass: !!pass, detail: detail || "" });
  if (c.control === "pricing") {
    const r = priceItems(ref, c.items, c.overrides || {});
    if (e.unpriced !== undefined) ok(`unpriced = ${e.unpriced}`, r.unpriced === e.unpriced, r.unpriced ? "unpriced" : `£${r.low}–£${r.high}`);
    for (const p of e.problems_include || []) ok(`problem ${p}`, r.problems.some((x) => x.problem === p), r.problems.map((x) => x.problem).join(",") || "none");
    for (const f of e.flags_include || []) ok(`flag ${f}`, r.flags.includes(f), r.flags.join(",") || "none");
    if (e.low !== undefined) ok(`low = ${e.low}`, r.low === e.low, String(r.low));
    if (e.high !== undefined) ok(`high = ${e.high}`, r.high === e.high, String(r.high));
    if (e.priced_rows !== undefined) ok(`priced rows = [${e.priced_rows}]`, JSON.stringify(r.price_book_refs) === JSON.stringify(e.priced_rows), r.price_book_refs.join(",") || "none");
    return [{ kind: "deterministic", id: c.id, title: c.title, checks, result: r, error: null }];
  }
  if (c.control === "legal") {
    const r = resolveLegal(ref, c.proposed);
    for (const id of e.refs_include || []) ok(`resolves ${id}`, r.refs.some((x) => x.id === id), r.refs.map((x) => x.id).join(",") || "none");
    for (const id of e.rejected_include || []) ok(`rejects ${id}`, r.rejected.some((x) => x.id === id), r.rejected.map((x) => x.id).join(",") || "none");
    if (e.refs_count !== undefined) ok(`${e.refs_count} citation(s)`, r.refs.length === e.refs_count, String(r.refs.length));
    return [{ kind: "deterministic", id: c.id, title: c.title, checks, result: r, error: null }];
  }
  if (c.control === "hazard") {
    const r = resolveHazard(ref, c.proposed);
    if (e.hazard !== undefined) ok(`hazard = ${e.hazard}`, (r.hazard ? r.hazard.id : null) === e.hazard, r.hazard ? r.hazard.label : "none");
    if (e.rejected !== undefined) ok(`rejected = ${e.rejected}`, !!r.rejected === e.rejected, r.rejected ? r.rejected.reason : "accepted");
    if (e.review_required !== undefined) ok(`review_required = ${e.review_required}`, !!(r.hazard && r.hazard.review_required) === e.review_required, r.hazard ? `confidence ${r.hazard.confidence}` : "none");
    return [{ kind: "deterministic", id: c.id, title: c.title, checks, result: r, error: null }];
  }
  if (c.control === "ids") {
    const packet = { sources: Object.fromEntries((c.packet_sources || []).map((id) => [id, { type: "photo" }])), photos: (c.packet_photos || []).map((no) => ({ no })) };
    const problems = validateIds(packet, c.evidence || { observations: [], statements: [], measurements: [] }, c.analysis || null, c.draft || null);
    ok(`≥ ${e.problems_min || 1} fabrication(s) detected`, problems.length >= (e.problems_min || 1), problems.join("; ") || "none");
    if (e.problems_match) ok(`problem mentions ${e.problems_match}`, problems.some((p) => new RegExp(e.problems_match, "i").test(p)), problems.join("; "));
    return [{ kind: "deterministic", id: c.id, title: c.title, checks, result: problems, error: null }];
  }
  if (c.control === "gate") {
    const packet = { complete: true, incomplete: [], unconfirmedLinks: [], photos: [{ no: 1 }], context: { builtPre2000: false } };
    const evidence = c.evidence || { observations: [{ id: "OBS-001", statement: "x", source_ids: ["PHOTO-1"] }], statements: [], measurements: [] };
    const causation = c.causation || { preferred_cause: "x", confidence: "medium", candidate_causes: [] };
    const pricing = c.pricing;
    const gate = decideGate({ packet, evidence, causation, analysis: c.analysis || null, legal: c.legal || { refs: [], rejected: [] }, pricing, verification: c.verification || { claims: [] }, idProblems: c.idProblems || [], confidence: { grade: "medium", reasons: [] } });
    ok(`gate = ${e.status}`, gate.status === e.status, `${gate.status}: ${gate.reasons.join("; ")}`);
    if (e.reasons_match) ok(`reason mentions ${e.reasons_match}`, gate.reasons.some((r) => new RegExp(e.reasons_match, "i").test(r)), gate.reasons.join("; "));
    for (const f of e.flags_include || []) ok(`flag ${f}`, gate.flags.includes(f), gate.flags.join(","));
    return [{ kind: "deterministic", id: c.id, title: c.title, checks, result: gate, error: null }];
  }
  throw new Error(`${c.id}: unknown control "${c.control}"`);
}

export async function runSuite(opts = {}) {
  const o = { filter: [], split: "development", categories: null, verbose: false, quiet: true, json: null, reportDir: RESULTS_DIR, ...opts };
  const log = o.quiet ? () => {} : (...a) => console.log(...a);
  // the pipeline's operational event lines and per-call provider lines are
  // for a server log; here they bury the verdicts unless asked for
  const info = console.info;
  if (!o.verbose) console.info = (...a) => { const s = String(a[0] || ""); if (!s.startsWith('{"evt"') && !s.startsWith("[ai]")) info(...a); };
  try { return await runSuiteInner(o, log); } finally { console.info = info; }
}

async function runSuiteInner(o, log) {
  const ref = loadReference(true);
  const cases = loadCases({ filter: o.filter, split: o.split, categories: o.categories });
  if (!cases.length) throw new Error("no cases matched");
  log(`pipeline: ${MOCK ? "AI_MOCK — harness and deterministic controls only; model numbers mean nothing" : `${AI_MODEL} (verifier ${AI_VERIFY_MODEL})`}`);
  log(`split: ${o.split} · ${cases.length} case(s)\n`);
  const results = [];
  const usage = [];
  for (const c of cases) {
    const base = { id: c.id, title: c.title, file: c.file, kind: c.kind, category: c.category, risk: c.risk, split: c.split, status: c.status };
    if (c.status === "REQUIRES_REAL_SURVEY_EVIDENCE") { results.push({ ...base, skipped: true, units: [] }); log(`○ ${c.id}  ${c.title}  — REQUIRES_REAL_SURVEY_EVIDENCE, not run`); continue; }
    let units;
    try {
      units = c.kind === "verifier" ? await runVerifierCase(c, ref) : c.kind === "deterministic" ? runDeterministicCase(c, ref) : await runPipelineCase(c, ref, o);
    } catch (e) {
      units = [{ kind: c.kind, id: c.id, title: c.title, checks: [{ rule: "harness", label: "case ran", severity: "critical", pass: false, detail: e.message }], error: { message: e.message } }];
    }
    for (const u of units) { if (u.run && u.run.usage) usage.push(u.run.usage); if (u.usage) usage.push(u.usage); }
    results.push({ ...base, units });
    for (const u of units) {
      const failed = u.checks.filter((k) => !k.pass && !k.skipped);
      const cls = u.kind === "pipeline" ? classifyUnit(u) : null;
      const mark = failed.length ? (failed.some((k) => k.severity === "critical") ? "✗" : "△") : "✓";
      log(`${mark} ${u.id}  ${u.title}${u.secs ? `  (${u.secs}s)` : ""}`);
      if (u.error && u.kind === "pipeline") log(`    pipeline: ${u.error.code || "error"} — ${u.error.message}${u.expectedError ? "  (expected)" : ""}`);
      if (u.finding) log(`    gate ${u.finding.gate.status} · confidence ${u.finding.confidence} · agreement ${u.finding.assessment.agreement} · cause "${u.finding.assessment.likely_cause || "—"}" · flags ${(u.finding.review_flags || []).join(",") || "none"}`);
      if (u.kind === "pipeline" && u.finding) { const ch = safetyChain(u), cal = calibration(u); log(`    controls: ${ch.fired.join(", ") || "none"}${ch.generatorAvoided ? " · generator avoided" : ""}${ch.escaped ? " · ESCAPED" : ""}${cal ? ` · calibration ${cal.quadrant}` : ""}${cls && cls.materialWrongConfident ? " · MATERIAL WRONG + CONFIDENT" : ""}`); }
      for (const k of u.checks) if (o.verbose || (!k.pass && !k.skipped)) log(`    ${k.pass ? "✓" : k.skipped ? "·" : k.severity === "critical" ? "✗" : "△"} [${k.severity}] ${k.label}${k.detail ? ` — ${k.detail}` : ""}`);
    }
  }
  const meta = {
    at: new Date().toISOString(), mock: MOCK, provider: MOCK ? "mock" : "anthropic", model: MOCK ? "mock" : AI_MODEL, verifyModel: MOCK ? "mock" : AI_VERIFY_MODEL, efforts: EFFORTS,
    pipelineVersion: PIPELINE_VERSION, promptHashes: PROMPT_HASHES, reference: { label: ref.label, versions: ref.versions, hashes: ref.hashes },
    split: o.split, usage: sumUsage(usage),
  };
  const summary = summarise(results, meta);
  fs.mkdirSync(o.reportDir, { recursive: true });
  const stamp = meta.at.replace(/[:.]/g, "-");
  const jsonPath = path.join(o.reportDir, `${stamp}-${MOCK ? "mock" : AI_MODEL}-${o.split}.json`);
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  fs.writeFileSync(jsonPath, JSON.stringify({ summary, results: results.map((r) => ({ ...r, units: (r.units || []).map((u) => ({ ...u, finding: undefined, run: undefined })) })) }, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(summary));
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(results, null, 2));
  return { summary, results, jsonPath, mdPath };
}

function printSummary(s, paths) {
  const h = s.headline;
  console.log("");
  if (s.meta.mock) console.log("MOCK RUN — validates the harness and the deterministic controls only. Model-dependent numbers below are NOT evidence of the model's reasoning.\n");
  console.log(`cases ${s.cases.total} (${s.cases.runnable} run, ${s.cases.requiresRealEvidence} need real survey evidence) · assertions ${s.assertions.total - s.assertions.failed}/${s.assertions.total}`);
  console.log(`critical failures ${h.criticalFailures} · major ${h.majorFailures} · minor ${h.minorFailures} · MATERIAL WRONG + CONFIDENT ${h.materialWrongConfident} · escaped all controls ${h.escapedAllControls}`);
  console.log(`unsupported material claims ${h.unsupportedMaterialClaims} · contradicted ${h.contradictedClaims} · contradicted presented as fact ${h.contradictedPresentedAsFact}`);
  console.log(`verifier catch ${s.verifier.detectedByVerifier}/${s.verifier.flaws} (gate caught ${s.verifier.caughtByDeterministicGate}, missed by both ${s.verifier.missedByBoth}) · deterministic controls ${s.deterministic.passed}/${s.deterministic.total}`);
  console.log(`false blocks ${h.falseBlocks} · correct but blocked ${h.correctButBlocked} · calibration ${Object.entries(s.calibration).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`safety chain ${Object.entries(s.safetyChain).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`tokens in ${s.meta.usage.input} (cache read ${s.meta.usage.cacheRead}) out ${s.meta.usage.output}`);
  console.log(`report: ${path.relative(process.cwd(), paths.mdPath)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  const { summary, jsonPath, mdPath } = await runSuite({ ...o, quiet: o.quiet });
  printSummary(summary, { jsonPath, mdPath });
  const h = summary.headline;
  const bad = h.criticalFailures > 0 || h.materialWrongConfident > 0 || summary.verifier.missedByBoth > 0 || summary.cases.pipelineErrors > 0 || summary.deterministic.passed < summary.deterministic.total;
  process.exit(MOCK ? (summary.deterministic.passed < summary.deterministic.total ? 1 : 0) : bad ? 1 : 0);
}

export { RULES, EVALS_DIR };
