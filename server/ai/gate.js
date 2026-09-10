// Deterministic rules run after the verifier. A second model's opinion is
// never what decides whether a finding may be put in front of the surveyor
// as review-ready; these rules are. They also compute the confidence grade
// (a property of the evidence, with its reasons) and the typed flags.
import { flagSeverity, sortFlags } from "../../shared/findingRules.js";

const ASBESTOS_WORDS = /artex|textured (coating|ceiling|finish)|asbestos|insulation board|aib|soffit board|cement (sheet|board)|vinyl floor tile/i;
const MATERIAL_TYPES = new Set(["observation", "measurement", "history", "extent"]);

export function computeConfidence({ evidence, causation, verification, packet, pricing }) {
  const reasons = [];
  let grade = ["high", "medium", "low"].includes(causation.confidence) ? causation.confidence : "low";
  const cap = (g, why) => { if (rank(g) < rank(grade)) { grade = g; } reasons.push(why); };
  const supporting = new Set((causation.candidate_causes || []).filter((c) => c.cause === causation.preferred_cause).flatMap((c) => c.supporting_observations || []));
  const obsById = Object.fromEntries((evidence.observations || []).map((o) => [o.id, o]));
  const photoSources = new Set([...supporting].flatMap((id) => (obsById[id] ? obsById[id].source_ids : [])).filter((s) => s.startsWith("PHOTO-")));
  if (photoSources.size >= 2) reasons.push(`${photoSources.size} photographs support the observed defect`);
  else if (photoSources.size === 1) cap("medium", "only one photograph supports the preferred cause");
  else cap("medium", "no photograph is cited for the preferred cause");
  if (!(evidence.measurements || []).length) cap("medium", "no readings or measurements were recorded");
  else reasons.push(`${evidence.measurements.length} reading${evidence.measurements.length === 1 ? "" : "s"} recorded`);
  const preferred = (causation.candidate_causes || []).find((c) => c.cause === causation.preferred_cause);
  if (preferred && (preferred.contrary_observations || []).length) cap("medium", "some observations count against the preferred cause");
  const openAlts = (causation.candidate_causes || []).filter((c) => c.cause !== causation.preferred_cause && c.confidence !== "low");
  if (openAlts.length) cap("medium", `${openAlts.length} alternative cause${openAlts.length === 1 ? "" : "s"} remain${openAlts.length === 1 ? "s" : ""} plausible`);
  if (!packet.complete) cap("low", "material evidence was not available to the analysis");
  if (packet.unconfirmedLinks.length) cap("medium", "some evidence links to this issue are not yet confirmed");
  const claims = (verification && verification.claims) || [];
  if (claims.some((c) => c.type === "causation" && c.support === "partially_supported")) cap("medium", "the verifier found the causation only partly supported");
  if (claims.some((c) => ["unsupported", "contradicted"].includes(c.support) && MATERIAL_TYPES.has(c.type))) cap("low", "the verifier found an unsupported factual claim");
  if (!causation.preferred_cause) cap("low", "the evidence did not carry a preferred cause");
  if (pricing && pricing.unpriced) reasons.push("cost not established from the price book");
  return { grade, reasons };
}
const rank = (g) => ({ high: 2, medium: 1, low: 0 }[g] ?? 0);

// Every id the model cited must exist — in the packet (sources) or among the
// observations it produced. Anything else is a fabrication and blocks.
export function validateIds(packet, evidence, analysis, draft) {
  const problems = [];
  // a photograph recorded as missing was never shown to any stage; citing it is a fabrication too
  const known = new Set([...Object.entries(packet.sources).filter(([, s]) => !s.missing).map(([id]) => id), ...(evidence.observations || []).map((o) => o.id), ...(evidence.statements || []).map((s) => s.id), ...(evidence.measurements || []).map((m) => m.id)]);
  const check = (list, where) => { for (const id of list || []) if (!known.has(id)) problems.push(`${where} cites unknown source ${id}`); };
  for (const o of evidence.observations || []) check(o.source_ids, o.id);
  for (const m of evidence.measurements || []) check(m.source_ids, m.id);
  const exhibits = new Set(packet.photos.map((p) => p.no));
  for (const n of (draft && draft.photo_refs) || []) if (!exhibits.has(n)) problems.push(`draft cites exhibit ${n}, which is not linked to this issue`);
  if (analysis) {
    check(analysis.comparison && analysis.comparison.evidence_supporting_surveyor, "comparison");
    check(analysis.comparison && analysis.comparison.evidence_contradicting_surveyor, "comparison");
    check(analysis.extent && analysis.extent.source_ids, "extent");
    for (const it of analysis.price_items || []) check(it.quantity_evidence, `price item ${it.price_book_row_id}`);
  }
  return problems;
}

export function asbestosRule({ packet, evidence, causation, analysis }) {
  const texts = [
    ...(evidence.observations || []).map((o) => o.statement),
    ...(evidence.statements || []).map((s) => s.statement),
    (analysis && analysis.remedial && analysis.remedial.works) || "",
  ].join(" | ");
  const mentionsMaterial = ASBESTOS_WORDS.test(texts);
  const modelFlag = !!(causation.asbestos_risk && causation.asbestos_risk.present);
  const disturbs = analysis && analysis.remedial && ["whole_element", "multiple_elements", "localised"].includes(analysis.remedial.scope);
  // pre-2000 unknown counts as "may be": a photograph never rules asbestos out
  const eraRisk = packet.context.builtPre2000 !== false;
  const flag = modelFlag || (mentionsMaterial && eraRisk && disturbs);
  return { flag, basis: modelFlag ? causation.asbestos_risk.basis : mentionsMaterial ? "a textured coating, board or similar material is recorded and the proposed works would disturb it" : "" };
}

// the decision: review_ready | blocked | incomplete_evidence, with reasons a
// surveyor can act on, and the flag set sorted by severity
export function decideGate({ packet, evidence, causation, analysis, legal, pricing, verification, idProblems, confidence }) {
  const reasons = [];
  const flags = new Set();
  const claims = (verification && verification.claims) || [];
  for (const c of claims) {
    if (c.support === "contradicted") { reasons.push(`contradicted by the evidence: "${c.claim}"`); flags.add("contradictory_evidence"); }
    else if (c.support === "unsupported" && MATERIAL_TYPES.has(c.type)) { reasons.push(`unsupported ${c.type}: "${c.claim}"`); flags.add("unsupported_claim"); }
  }
  for (const p of idProblems || []) { reasons.push(p); flags.add("unsupported_claim"); }
  for (const r of (legal && legal.rejected) || []) { reasons.push(`legal reference ${r.id} is not in the register`); flags.add("legal_check"); }
  for (const p of (pricing && pricing.problems) || []) {
    if (["unknown_row", "inactive_row"].includes(p.problem)) reasons.push(`price book row ${p.row_id}: ${p.detail}`);
  }
  if (pricing && !pricing.unpriced) {
    // arithmetic cross-check: the stored totals must equal the lines
    const low = pricing.lines.filter((l) => l.priced).reduce((s, l) => s + l.low, 0);
    const high = pricing.lines.filter((l) => l.priced).reduce((s, l) => s + l.high, 0);
    if (low !== pricing.low || high !== pricing.high) reasons.push("calculated cost does not match its lines");
  }
  const blocked = reasons.length > 0;

  // warnings
  if (analysis && analysis.comparison && ["disagree", "uncertain"].includes(analysis.comparison.agreement)) flags.add("disagreement");
  if (analysis && analysis.remedial && (analysis.remedial.scope_uncertain || analysis.remedial.scope === "investigation_first")) flags.add("scope_uncertain");
  for (const f of (pricing && pricing.flags) || []) flags.add(f);
  if (legal && legal.refs.length === 0 && analysis && analysis.comparison && analysis.comparison.agreement !== "no_hypothesis") { /* empty is a choice, not a flag */ }
  if (!packet.photos.length) flags.add("no_photo_evidence");
  else {
    const cited = new Set((evidence.observations || []).flatMap((o) => o.source_ids).filter((s) => s.startsWith("PHOTO-")));
    if (!cited.size) flags.add("no_photo_evidence");
  }
  if (confidence.grade === "low") flags.add("low_confidence");
  if (packet.unconfirmedLinks.length) flags.add("unconfirmed_association");
  if (claims.some((c) => c.severity === "review" || c.support === "partially_supported")) flags.add("partially_supported");
  if (!packet.complete) flags.add("incomplete_evidence");

  const status = blocked ? "blocked" : !packet.complete ? "incomplete_evidence" : "review_ready";
  const incompleteReasons = packet.incomplete.map((i) => `${i.source_id}: ${i.reason}`);
  return {
    status,
    reasons: blocked ? reasons : status === "incomplete_evidence" ? incompleteReasons : [],
    incomplete: incompleteReasons,
    flags: sortFlags([...flags].filter((f) => f !== "partially_supported")),
    blockingFlags: [...flags].filter((f) => flagSeverity(f) === "blocking"),
  };
}
