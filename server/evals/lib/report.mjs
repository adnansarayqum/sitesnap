// Turns per-case results into the headline metrics the suite exists to
// produce: critical failures, material-wrong-and-confident, what each control
// caught, calibration quadrants. Nothing here averages a score — the numbers
// that matter are counts of things that must be zero.
import { MATERIAL } from "./assertions.mjs";

const GRADE = { high: 2, medium: 1, low: 0 };

export function classifyUnit(unit) {
  const failed = unit.checks.filter((c) => !c.pass && !c.skipped);
  const bySeverity = { critical: failed.filter((c) => c.severity === "critical"), major: failed.filter((c) => c.severity === "major"), minor: failed.filter((c) => c.severity === "minor") };
  const f = unit.finding;
  const reviewReady = !!f && f.gate.status === "review_ready";
  const confident = !!f && f.confidence !== "low";
  return {
    failed: failed.length, critical: bySeverity.critical.length, major: bySeverity.major.length, minor: bySeverity.minor.length,
    // the headline: something materially wrong, and the pipeline would have
    // put it in front of the surveyor as review-ready with medium/high confidence
    materialWrongConfident: bySeverity.critical.length > 0 && reviewReady && confident,
    unsupportedMaterialClaims: f ? f.verification.claims.filter((k) => k.support === "unsupported" && MATERIAL.has(k.type)).length : 0,
    contradictedClaims: f ? f.verification.claims.filter((k) => k.support === "contradicted").length : 0,
    contradictedPresentedAsFact: f ? f.verification.claims.filter((k) => k.support === "contradicted").length > 0 && reviewReady : false,
  };
}

// which control did the work: the generator avoided the problem, or the
// verifier / deterministic checks caught what it produced, or nothing did
export function safetyChain(unit) {
  const f = unit.finding, r = unit.run;
  const fired = [];
  if (unit.error && unit.error.code === "not_eligible") fired.push("eligibility_prevented_analysis");
  if (!f) return { fired, escaped: false, generatorAvoided: false };
  const st = r.stages || {};
  if ((st.legal && st.legal.rejected || []).length) fired.push("server_legal_validation");
  if ((f.cost.problems || []).some((p) => ["unknown_row", "inactive_row", "overlap"].includes(p.problem))) fired.push("server_price_validation");
  if ((f.cost.problems || []).some((p) => p.problem === "quantity_required")) fired.push("server_quantity_rule");
  if ((f.gate.reasons || []).some((x) => /cites unknown source|cites exhibit|does not match its lines/.test(x))) fired.push("deterministic_id_or_arithmetic_check");
  if (f.verification.claims.some((k) => k.support === "contradicted" || (k.support === "unsupported" && MATERIAL.has(k.type)) || k.severity === "block")) fired.push("verifier_detected");
  if (f.gate.status === "blocked") fired.push("deterministic_gate_blocked");
  if (f.gate.status === "incomplete_evidence") fired.push("deterministic_gate_incomplete");
  if ((f.review_flags || []).some((x) => !["partial_visual_review", "style"].includes(x))) fired.push("human_review_flagged");
  const cls = classifyUnit(unit);
  const generatorAvoided = !fired.some((x) => ["server_legal_validation", "server_price_validation", "deterministic_id_or_arithmetic_check", "verifier_detected", "deterministic_gate_blocked"].includes(x)) && cls.critical === 0;
  return { fired, escaped: cls.critical > 0 && f.gate.status !== "blocked", generatorAvoided };
}

// correct + appropriate / correct + underconfident / wrong + uncertain / wrong + overconfident
export function calibration(unit) {
  const cal = unit.calibration;
  const f = unit.finding;
  if (!cal || !f) return null;
  const cause = f.assessment.likely_cause || "";
  const correct = cal.truth ? new RegExp(cal.truth, "i").test(cause) : (!cause || f.confidence === "low");
  const ceiling = GRADE[cal.evidence_supports || "medium"];
  const grade = GRADE[f.confidence];
  const reviewReady = f.gate.status === "review_ready";
  let quadrant;
  if (correct) quadrant = grade < ceiling ? "correct_underconfident" : grade > ceiling ? "correct_overconfident" : "correct_appropriate";
  else quadrant = (grade >= 1 && reviewReady) ? "wrong_overconfident" : "wrong_uncertain";
  return { correct, quadrant, confidence: f.confidence, ceiling: cal.evidence_supports || "medium", gate: f.gate.status, cause };
}

export function summarise(results, meta) {
  const units = results.flatMap((r) => r.units || []);
  const pipelineUnits = units.filter((u) => u.kind === "pipeline");
  const byCategory = {}, byRisk = {}, bySplit = {};
  for (const r of results) { byCategory[r.category] = (byCategory[r.category] || 0) + 1; byRisk[r.risk || "unspecified"] = (byRisk[r.risk || "unspecified"] || 0) + 1; bySplit[r.split] = (bySplit[r.split] || 0) + 1; }
  const skipped = results.filter((r) => r.skipped);
  const errored = pipelineUnits.filter((u) => u.error && !u.expectedError);

  const cls = pipelineUnits.map((u) => ({ u, c: classifyUnit(u), chain: safetyChain(u), cal: calibration(u) }));
  const count = (fn) => cls.filter(fn).length;
  const chainTally = {};
  for (const x of cls) { for (const f of x.chain.fired) chainTally[f] = (chainTally[f] || 0) + 1; if (x.chain.generatorAvoided) chainTally.generator_avoided = (chainTally.generator_avoided || 0) + 1; if (x.chain.escaped) chainTally.escaped_all_controls = (chainTally.escaped_all_controls || 0) + 1; }
  const quadrants = { correct_appropriate: 0, correct_underconfident: 0, correct_overconfident: 0, wrong_uncertain: 0, wrong_overconfident: 0 };
  for (const x of cls) if (x.cal) quadrants[x.cal.quadrant] += 1;

  // expected review_ready but blocked → a false block; correct cause but blocked → unnecessarily blocked
  const falseBlocks = cls.filter((x) => x.u.finding && x.u.finding.gate.status === "blocked" && x.u.checks.some((k) => k.rule === "gate_in" && (k.values || []).includes("review_ready") && !(k.values || []).includes("blocked")));
  const correctButBlocked = cls.filter((x) => x.cal && x.cal.correct && x.u.finding.gate.status === "blocked");

  const verifierUnits = units.filter((u) => u.kind === "verifier");
  const flaws = verifierUnits.flatMap((u) => u.flaws || []);
  const det = units.filter((u) => u.kind === "deterministic");

  return {
    meta,
    cases: { total: results.length, runnable: results.length - skipped.length, requiresRealEvidence: skipped.length, byCategory, byRisk, bySplit, pipelineErrors: errored.length },
    assertions: { total: units.reduce((s, u) => s + u.checks.length, 0), failed: units.reduce((s, u) => s + u.checks.filter((c) => !c.pass && !c.skipped).length, 0) },
    headline: {
      criticalFailures: count((x) => x.c.critical > 0), criticalAssertionsFailed: cls.reduce((s, x) => s + x.c.critical, 0),
      majorFailures: count((x) => x.c.major > 0), minorFailures: count((x) => x.c.minor > 0),
      materialWrongConfident: count((x) => x.c.materialWrongConfident),
      unsupportedMaterialClaims: cls.reduce((s, x) => s + x.c.unsupportedMaterialClaims, 0),
      contradictedClaims: cls.reduce((s, x) => s + x.c.contradictedClaims, 0),
      contradictedPresentedAsFact: count((x) => x.c.contradictedPresentedAsFact),
      falseBlocks: falseBlocks.length, correctButBlocked: correctButBlocked.length,
      escapedAllControls: chainTally.escaped_all_controls || 0,
    },
    verifier: {
      flaws: flaws.length,
      detectedByVerifier: flaws.filter((f) => f.detectedByVerifier).length,
      caughtByDeterministicGate: flaws.filter((f) => f.caughtByGate).length,
      missedByBoth: flaws.filter((f) => !f.detectedByVerifier && !f.caughtByGate).length,
      catchRate: flaws.length ? flaws.filter((f) => f.detectedByVerifier).length / flaws.length : null,
    },
    deterministic: { total: det.length, passed: det.filter((u) => u.checks.every((c) => c.pass)).length },
    safetyChain: chainTally,
    calibration: quadrants,
    lists: {
      materialWrongConfident: cls.filter((x) => x.c.materialWrongConfident).map((x) => x.u.id),
      critical: cls.filter((x) => x.c.critical > 0).map((x) => ({ id: x.u.id, failed: x.u.checks.filter((c) => !c.pass && c.severity === "critical").map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`) })),
      wrongOverconfident: cls.filter((x) => x.cal && x.cal.quadrant === "wrong_overconfident").map((x) => x.u.id),
      missedFlaws: flaws.filter((f) => !f.detectedByVerifier && !f.caughtByGate).map((f) => `${f.caseId}: ${f.label}`),
      skipped: skipped.map((r) => `${r.id} — ${r.title}`),
      errors: errored.map((u) => `${u.id}: ${u.error.message}`),
    },
  };
}

export function toMarkdown(s) {
  const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
  const L = [];
  L.push(`# Golden evaluation report`);
  L.push("");
  if (s.meta.mock) L.push(`> **MOCK RUN.** \`AI_MOCK=1\`: every model stage was a deterministic stand-in. This run validates the harness, the assertions and the server-side deterministic controls. It says **nothing** about the model's professional reasoning. Do not quote these numbers as AI accuracy.`);
  else L.push(`> Real-provider run. Model ${s.meta.model}, verifier ${s.meta.verifyModel}, pipeline ${s.meta.pipelineVersion}.`);
  L.push("");
  L.push(`| | |`); L.push(`|---|---|`);
  L.push(`| Run at | ${s.meta.at} |`);
  L.push(`| Provider | ${s.meta.mock ? "mock" : "anthropic"} |`);
  L.push(`| Model / verifier | ${s.meta.model} / ${s.meta.verifyModel} |`);
  L.push(`| Efforts | ${Object.entries(s.meta.efforts || {}).map(([k, v]) => `${k}=${v}`).join(", ")} |`);
  L.push(`| Pipeline version | ${s.meta.pipelineVersion} |`);
  L.push(`| Prompt hashes | ${Object.entries(s.meta.promptHashes || {}).map(([k, v]) => `${k}:${v}`).join(" ")} |`);
  L.push(`| Reference | ${s.meta.reference.label}; hashes ${Object.entries(s.meta.reference.hashes || {}).map(([k, v]) => `${k}:${v}`).join(" ")} |`);
  L.push(`| Split | ${s.meta.split} |`);
  L.push(`| Tokens | in ${s.meta.usage.input} (cache read ${s.meta.usage.cacheRead}, write ${s.meta.usage.cacheWrite}) · out ${s.meta.usage.output} |`);
  L.push("");
  L.push(`## Headline`);
  L.push("");
  L.push(`| Metric | Value |`); L.push(`|---|---|`);
  L.push(`| Cases | ${s.cases.total} (${s.cases.runnable} runnable, ${s.cases.requiresRealEvidence} REQUIRES_REAL_SURVEY_EVIDENCE — not counted) |`);
  L.push(`| Pipeline errors (unexpected) | ${s.cases.pipelineErrors} |`);
  L.push(`| **Critical failures (cases)** | **${s.headline.criticalFailures}** (${s.headline.criticalAssertionsFailed} assertions) |`);
  L.push(`| Major failures (cases) | ${s.headline.majorFailures} |`);
  L.push(`| Minor failures (cases) | ${s.headline.minorFailures} |`);
  L.push(`| **Material wrong + confident** | **${s.headline.materialWrongConfident}** |`);
  L.push(`| Escaped all controls (critical, not blocked) | ${s.headline.escapedAllControls} |`);
  L.push(`| Unsupported material claims (verifier) | ${s.headline.unsupportedMaterialClaims} |`);
  L.push(`| Contradicted claims (verifier) | ${s.headline.contradictedClaims} |`);
  L.push(`| Contradicted claims presented as fact | ${s.headline.contradictedPresentedAsFact} |`);
  L.push(`| Verifier catch rate (flawed drafts) | ${pct(s.verifier.catchRate)} (${s.verifier.detectedByVerifier}/${s.verifier.flaws}; deterministic gate caught ${s.verifier.caughtByDeterministicGate}; missed by both ${s.verifier.missedByBoth}) |`);
  L.push(`| Deterministic control cases | ${s.deterministic.passed}/${s.deterministic.total} |`);
  L.push(`| False blocks | ${s.headline.falseBlocks} |`);
  L.push(`| Correct but unnecessarily blocked | ${s.headline.correctButBlocked} |`);
  L.push("");
  L.push(`## Safety chain — which control did the work`);
  L.push("");
  L.push(`| Control | Cases |`); L.push(`|---|---|`);
  for (const k of ["generator_avoided", "eligibility_prevented_analysis", "verifier_detected", "deterministic_gate_blocked", "deterministic_gate_incomplete", "server_legal_validation", "server_price_validation", "server_quantity_rule", "deterministic_id_or_arithmetic_check", "human_review_flagged", "escaped_all_controls"]) L.push(`| ${k} | ${s.safetyChain[k] || 0} |`);
  L.push("");
  L.push(`## Confidence calibration`);
  L.push("");
  L.push(`| Quadrant | Cases |`); L.push(`|---|---|`);
  for (const [k, v] of Object.entries(s.calibration)) L.push(`| ${k}${k === "wrong_overconfident" ? " **(reduce to zero)**" : ""} | ${v} |`);
  L.push("");
  L.push(`## Coverage`);
  L.push("");
  L.push(`Category: ${Object.entries(s.cases.byCategory).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  L.push("");
  L.push(`Risk domain: ${Object.entries(s.cases.byRisk).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  L.push("");
  if (s.lists.critical.length) { L.push(`## Critical failures`); L.push(""); for (const c of s.lists.critical) { L.push(`- **${c.id}**`); for (const f of c.failed) L.push(`  - ${f}`); } L.push(""); }
  if (s.lists.materialWrongConfident.length) { L.push(`## Material wrong + confident`); L.push(""); for (const id of s.lists.materialWrongConfident) L.push(`- ${id}`); L.push(""); }
  if (s.lists.wrongOverconfident.length) { L.push(`## Wrong + overconfident`); L.push(""); for (const id of s.lists.wrongOverconfident) L.push(`- ${id}`); L.push(""); }
  if (s.lists.missedFlaws.length) { L.push(`## Flawed drafts missed by verifier and gate`); L.push(""); for (const x of s.lists.missedFlaws) L.push(`- ${x}`); L.push(""); }
  if (s.lists.errors.length) { L.push(`## Pipeline errors`); L.push(""); for (const x of s.lists.errors) L.push(`- ${x}`); L.push(""); }
  if (s.lists.skipped.length) { L.push(`## Not run — REQUIRES_REAL_SURVEY_EVIDENCE`); L.push(""); for (const x of s.lists.skipped) L.push(`- ${x}`); L.push(""); }
  return L.join("\n");
}
