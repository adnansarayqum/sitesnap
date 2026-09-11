// Orchestrates one issue through the staged pipeline and returns two
// things: the finding the surveyor reviews, and the run record that lets
// anyone reconstruct how it was produced — what evidence, which prompts,
// which reference versions, what every stage said, what the verifier found
// and what the deterministic gate decided.
//
//   packet → evidence → causation (blind) → analysis → legal + pricing
//          → draft → verify → gate → finding
import crypto from "node:crypto";
import { loadReference, resolveLegal, resolveHazard, priceItems, sha } from "../reference.js";
import { issueEligibility } from "../../shared/eligibility.js";
import { buildPacket } from "./packet.js";
import { evidenceStage, causationStage, analysisStage, draftStage, verifyStage } from "./stages.js";
import { computeConfidence, validateIds, asbestosRule, decideGate } from "./gate.js";
import { PROMPT_HASHES } from "./prompts.js";
import { EFFORTS, AI_MODEL, AI_VERIFY_MODEL, MOCK, sumUsage } from "./provider.js";
import { event } from "./events.js";

export const PIPELINE_VERSION = "2.1.0";
const h = (v) => sha(v).slice(0, 16);

// Each stage's input is hashed. Given the previous run for the same issue
// (`prior`), a stage whose inputs — evidence, upstream results, prompt and
// reference pack — are byte-for-byte what they were is reused rather than
// re-run, and the run says so. Anything upstream changing (a corrected
// transcript, a moved photo, a new corrections version) changes the hash
// and everything downstream re-runs: the dependency chain invalidates
// itself. `force` names stages to re-run regardless ("re-check only").
function reuse(prior, stage, inputHash, force) {
  if (!prior || !prior.stageHashes || !prior.stages || force.includes(stage)) return null;
  if (prior.stageHashes[stage] !== inputHash || prior.stages[stage] == null) return null;
  return prior.stages[stage];
}

// `input` is the app's request (see packet.js for the shape). Throws with a
// status when the issue is not eligible — the server is the authority on that.
// `ref` lets the caller hand in the reference pack already merged with the
// firm's own rates (server/pricebook.js); the file pack alone otherwise.
export async function runIssuePipeline(input, { signal, now = Date.now, prior = null, force = [], ref: refIn = null } = {}) {
  const eligibility = issueEligibility(input.issue, input.room, {});
  if (!eligibility.eligible) {
    const e = new Error(`This issue has no evidence a finding can rest on: ${eligibility.missing.join("; ") || "nothing a person recorded"}.`);
    e.status = 422; e.code = "not_eligible"; e.detail = eligibility; throw e;
  }
  const ref = refIn || loadReference();
  const packet = buildPacket(input);
  const t0 = now();
  const stages = {};
  const stageHashes = {};
  const reused = [];
  const usage = [];
  const ids = { issue: packet.issue.id, request: packet.requestId };
  const stageEvent = (stage, status, extra) => event(`${stage}_${status}`, { ...ids, ...extra });

  // 1. what was seen, said and measured
  stageHashes.evidence = h({ sources: packet.sources, note: packet.note, desc: packet.desc, prompt: PROMPT_HASHES.evidence, corrections: ref.hashes.corrections, model: AI_MODEL, effort: EFFORTS.evidence });
  let ev;
  const evPrior = reuse(prior, "evidence", stageHashes.evidence, force);
  if (evPrior) { ev = { evidence: evPrior, usage: [], model: prior.models && prior.models.evidence, servedByFallback: null, batches: prior.evidence && prior.evidence.evidenceBatches }; reused.push("evidence"); }
  else {
    stageEvent("evidence_analysis", "started", { photos: packet.photos.length });
    try { ev = await evidenceStage(packet, ref, { signal }); } catch (e) { stageEvent("evidence_analysis", "failed", { code: e.code, status: e.status }); throw e; }
    stageEvent("evidence_analysis", "completed", { observations: ev.evidence.observations.length, batches: ev.batches });
  }
  stages.evidence = ev.evidence; usage.push(...ev.usage);

  // 2. cause, blind to the surveyor's view
  stageHashes.causation = h({ evidence: ev.evidence, prompt: PROMPT_HASHES.causation, playbook: ref.hashes.playbook, corrections: ref.hashes.corrections, model: AI_MODEL, effort: EFFORTS.causation, photos: Object.fromEntries(packet.photos.map((p) => [p.id, packet.sources[p.id].hash])) });
  let ca;
  const caPrior = reuse(prior, "causation", stageHashes.causation, force);
  if (caPrior) { const { photos_shown, partial_visual_review, ...output } = caPrior; ca = { output, usage: null, model: prior.models && prior.models.causation, servedByFallback: null, photosShown: photos_shown || [], partialVisual: !!partial_visual_review }; reused.push("causation"); }
  else {
    stageEvent("causation", "started");
    try { ca = await causationStage(packet, ev.evidence, ref, { signal }); } catch (e) { stageEvent("causation", "failed", { code: e.code, status: e.status }); throw e; }
    stageEvent("causation", "completed", { confidence: ca.output.confidence, candidates: (ca.output.candidate_causes || []).length });
  }
  stages.causation = { ...ca.output, photos_shown: ca.photosShown, partial_visual_review: ca.partialVisual }; usage.push(ca.usage);

  // 3–6. comparison, scope, controlled selections
  stageHashes.analysis = h({ evidence: ev.evidence, causation: ca.output, hypothesis: packet.hypothesis, prompt: PROMPT_HASHES.analysis, ref: [ref.hashes.playbook, ref.hashes.corrections, ref.hashes.legal, ref.hashes.hhsrs, ref.hashes.priceBook, ref.hashes.legalNotes], model: AI_MODEL, effort: EFFORTS.analysis });
  let an;
  const anPrior = reuse(prior, "analysis", stageHashes.analysis, force);
  if (anPrior) { an = { output: anPrior, usage: null, model: prior.models && prior.models.analysis, servedByFallback: null }; reused.push("analysis"); }
  else {
    try { an = await analysisStage(packet, ev.evidence, ca.output, ref, { signal }); } catch (e) { stageEvent("hypothesis_comparison", "failed", { code: e.code, status: e.status }); throw e; }
    stageEvent("hypothesis_comparison", "completed", { agreement: an.output.comparison.agreement });
    stageEvent("remedial_analysis", "completed", { scope: an.output.remedial.scope });
  }
  stages.analysis = an.output; usage.push(an.usage);
  const legal = resolveLegal(ref, an.output.legal_refs);
  const hazard = resolveHazard(ref, an.output.hhsrs);
  if (hazard.rejected) legal.rejected.push(hazard.rejected);
  event("pricing_started", { ...ids, items: (an.output.price_items || []).length });
  const pricing = priceItems(ref, an.output.price_items, input.quantityOverrides || {});
  event("pricing_completed", { ...ids, unpriced: pricing.unpriced, lines: pricing.lines.length, problems: pricing.problems.map((p) => p.problem) });
  stages.legal = legal; stages.hazard = hazard.hazard; stages.pricing = pricing;

  // confidence is a property of the evidence — computed before the prose so
  // the drafter is told how qualified to be
  const preConfidence = computeConfidence({ evidence: ev.evidence, causation: ca.output, verification: null, packet, pricing });
  const asbestos = asbestosRule({ packet, evidence: ev.evidence, causation: ca.output, analysis: an.output });
  const conditions = uniq([...(an.output.remedial.conditions || []), ...(asbestos.flag && !(an.output.remedial.conditions || []).some((c) => /asbestos/i.test(c)) ? ["subject to asbestos sampling and results"] : [])]);

  // 7. wording, from validated inputs only
  const draftInputs = {
    observations: ev.evidence.observations, measurements: ev.evidence.measurements,
    causation: { preferred_cause: ca.output.preferred_cause, reasoning: ca.output.reasoning, alternatives: (ca.output.candidate_causes || []).filter((c) => c.cause !== ca.output.preferred_cause).map((c) => c.cause) },
    confidence: preConfidence,
    comparison: an.output.comparison,
    remedial: { ...an.output.remedial, conditions },
    extent: an.output.extent,
    legal_citations: legal.refs.map((r) => r.cite),
    hhsrs: hazard.hazard ? hazard.hazard.label : null,
    cost: pricing.unpriced ? { unpriced: true, note: an.output.pricing_note || pricing.basis } : { low: pricing.low, high: pricing.high, currency: pricing.currency },
  };
  stageHashes.draft = h({ inputs: draftInputs, prompt: PROMPT_HASHES.draft, style: ref.hashes.style, legalNotes: ref.hashes.legalNotes, model: AI_MODEL, effort: EFFORTS.draft });
  let dr;
  const drPrior = reuse(prior, "draft", stageHashes.draft, force);
  if (drPrior) { dr = { output: drPrior, usage: null, model: prior.models && prior.models.draft, servedByFallback: null }; reused.push("draft"); }
  else {
    try { dr = await draftStage(packet, draftInputs, ref, { signal }); } catch (e) { event("finding_draft_failed", { ...ids, code: e.code, status: e.status }); throw e; }
    event("finding_generated", { ...ids, photo_refs: (dr.output.photo_refs || []).length });
  }
  stages.draft = dr.output; usage.push(dr.usage);

  // 8. audit the prose against the sources — a separate call, separate
  // instructions, the raw sources handed over again
  stageHashes.verification = h({ evidence: ev.evidence, causation: ca.output, analysis: an.output, draft: dr.output, prompt: PROMPT_HASHES.verify, model: AI_VERIFY_MODEL, effort: EFFORTS.verify });
  let ve;
  const vePrior = reuse(prior, "verification", stageHashes.verification, force);
  if (vePrior) { ve = { output: vePrior, usage: null, model: prior.models && prior.models.verify, servedByFallback: null }; reused.push("verification"); }
  else {
    stageEvent("verification", "started");
    try { ve = await verifyStage(packet, ev.evidence, { causation: ca.output, analysis: an.output }, dr.output, { signal }); } catch (e) { stageEvent("verification", "failed", { code: e.code, status: e.status }); throw e; }
  }
  stages.verification = ve.output; usage.push(ve.usage);

  // deterministic decision
  const idProblems = validateIds(packet, ev.evidence, an.output, dr.output);
  const confidence = computeConfidence({ evidence: ev.evidence, causation: ca.output, verification: ve.output, packet, pricing });
  const gate = decideGate({ packet, evidence: ev.evidence, causation: ca.output, analysis: an.output, legal, pricing, verification: ve.output, idProblems, confidence });
  if (asbestos.flag) gate.flags = uniqFlags([...gate.flags, "asbestos"]);
  if (ca.partialVisual) gate.flags = uniqFlags([...gate.flags, "partial_visual_review"]);
  stages.confidence = confidence; stages.asbestos = asbestos;
  event(gate.status === "blocked" ? "verification_blocked" : "verification_completed", { ...ids, gate: gate.status, flags: gate.flags, claims: (ve.output.claims || []).length, reused });

  const runId = packet.requestId || crypto.randomUUID();
  const finding = {
    title: dr.output.title, location: dr.output.location,
    defect: dr.output.defect, cause_text: dr.output.cause || "", photo_refs: uniq(dr.output.photo_refs || []).filter((n) => packet.photos.some((p) => p.no === n)),
    surveyor_hypothesis: packet.hypothesis || "",
    assessment: {
      likely_cause: ca.output.preferred_cause || "", agreement: an.output.comparison.agreement, reasoning: an.output.comparison.reasoning,
      differences: an.output.comparison.differences || [],
      alternative_causes: (ca.output.candidate_causes || []).filter((c) => c.cause !== ca.output.preferred_cause).map((c) => c.cause),
      supporting: uniq((ca.output.candidate_causes || []).filter((c) => c.cause === ca.output.preferred_cause).flatMap((c) => c.supporting_observations || [])),
      contrary: uniq((ca.output.candidate_causes || []).filter((c) => c.cause === ca.output.preferred_cause).flatMap((c) => c.contrary_observations || [])),
      evidence_supporting_surveyor: an.output.comparison.evidence_supporting_surveyor || [],
      evidence_contradicting_surveyor: an.output.comparison.evidence_contradicting_surveyor || [],
      independent_confidence: ca.output.confidence,
    },
    legislation: legal.refs.map((r) => r.cite), legal_refs: legal.refs,
    hhsrs_hazard: hazard.hazard ? hazard.hazard.label : "", hazard: hazard.hazard,
    remedial: { works: dr.output.works || an.output.remedial.works, scope: an.output.remedial.scope, scope_rationale: an.output.remedial.scope_rationale, conditions, assumptions: an.output.remedial.assumptions || [] },
    cost: {
      low: pricing.unpriced ? 0 : pricing.low, high: pricing.unpriced ? 0 : pricing.high, currency: pricing.currency,
      basis: pricing.unpriced ? (an.output.pricing_note || pricing.basis) : pricing.basis,
      price_book_refs: pricing.price_book_refs, unpriced: pricing.unpriced, lines: pricing.lines, problems: pricing.problems, partial: pricing.partial,
      priceBookVersion: pricing.priceBookVersion,
    },
    confidence: confidence.grade, confidence_reasons: confidence.reasons,
    review_flags: gate.flags,
    // mock output is labelled at every level so it can never pass as real
    mock: MOCK || undefined,
    evidence_gaps: uniq([...(ev.evidence.evidence_gaps || []), ...(ca.output.evidence_gaps || [])]),
    evidence: { observations: ev.evidence.observations, statements: ev.evidence.statements, measurements: ev.evidence.measurements, sources: packet.sources, unreadable: ev.evidence.unreadable_sources },
    verification: ve.output,
    gate,
  };

  const run = {
    id: runId, pipelineVersion: PIPELINE_VERSION, at: new Date(t0).toISOString(), durationMs: now() - t0,
    issueId: packet.issue.id, snapshot: packet.snapshot,
    provider: MOCK ? "mock" : "anthropic",
    model: dr.model, models: { evidence: ev.model, causation: ca.model, analysis: an.model, draft: dr.model, verify: ve.model },
    configuredModel: AI_MODEL, verifyModel: AI_VERIFY_MODEL, efforts: { ...EFFORTS },
    servedByFallback: ev.servedByFallback || ca.servedByFallback || an.servedByFallback || dr.servedByFallback || ve.servedByFallback || null,
    prompts: { ...PROMPT_HASHES },
    reference: {
      label: ref.label, versions: ref.versions, hashes: ref.hashes,
      cited: {
        priceRows: Object.fromEntries(pricing.lines.map((l) => [l.row_id, l.rowHash])),
        legal: Object.fromEntries(legal.refs.map((r) => [r.id, r.hash])),
        hazard: hazard.hazard ? { [hazard.hazard.id]: hazard.hazard.hash } : {},
      },
    },
    evidence: {
      sources: packet.sources, complete: packet.complete, incomplete: packet.incomplete,
      photosAnalysed: packet.photos.length, evidenceBatches: ev.batches, photosShownToCausation: ca.photosShown.length,
      unconfirmedLinks: packet.unconfirmedLinks,
    },
    eligibility,
    stages, stageHashes, reused, force: force.length ? force : undefined,
    usage: sumUsage(usage),
  };
  return { finding, run };
}

const uniq = (a) => [...new Set(a || [])];
const uniqFlags = (a) => [...new Set(a)];
