// The rule library a golden case's `expected` and `must_not_happen` entries
// resolve to. Every rule reads the pipeline's *output* (finding + run record)
// and returns pass/fail with a detail string a reviewer can act on. Rules are
// deliberately conservative about prose: where wording can legitimately vary,
// the check is on the structured fields the gate and the report actually use.
//
// Severity: critical — material unsupported/invented/contradicted content that
// could reach an approved finding; major — wrong but qualified, wrong scope or
// row, significant omission; minor — wording.

const lower = (s) => String(s || "").toLowerCase();
const re = (p, flags = "i") => (p instanceof RegExp ? p : new RegExp(p, flags));
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const GRADE = { high: 2, medium: 1, low: 0 };
const MATERIAL = new Set(["observation", "measurement", "history", "extent"]);

// the prose fields of a finding, by name
function texts(f, where = "all") {
  if (!f) return "";
  const parts = {
    title: f.title, location: f.location, defect: f.defect, cause: f.cause_text,
    works: f.remedial && f.remedial.works, rationale: f.remedial && f.remedial.scope_rationale,
    conditions: (f.remedial && f.remedial.conditions || []).join(". "),
  };
  if (where === "all") return Object.values(parts).filter(Boolean).join("\n");
  return arr(where).map((w) => parts[w] || "").join("\n");
}
const sentences = (t) => String(t || "").split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

// everything a person wrote, said or measured for this issue — the ground
// truth a figure in the prose must come from
function sourceText(ctx) {
  const i = ctx.input || {};
  return [
    i.note && i.note.text, i.issue && i.issue.description, i.issue && i.issue.humanSuspectedCause, i.roomHypothesis,
    ...(i.memos || []).map((m) => m.transcript && m.transcript.text),
    ...(i.readings || []).map((r) => `${r.text} ${r.value} ${r.unit}`),
    ...(i.photos || []).map((p) => p.caption),
  ].filter(Boolean).join("\n");
}
const numbersIn = (t) => new Set((String(t || "").match(/\d+(?:\.\d+)?/g) || []));

const priced = (f) => ((f && f.cost && f.cost.lines) || []).filter((l) => l.priced);
const rowIds = (f) => new Set([...((f && f.cost && f.cost.price_book_refs) || []), ...((f && f.cost && f.cost.lines) || []).map((l) => l.row_id)]);
const legalIds = (f) => ((f && f.legal_refs) || []).map((r) => r.id);
const legalText = (f) => ((f && f.legal_refs) || []).map((r) => `${r.id} ${r.cite} ${r.title}`).join(" | ");
const hazardId = (f) => (f && f.hazard ? f.hazard.id : "none");
const claims = (f) => ((f && f.verification && f.verification.claims) || []);
const flags = (f) => new Set((f && f.review_flags) || []);

export const RULES = {
  // ---- pipeline outcome ----------------------------------------------------
  pipeline_succeeded: (c) => ({ pass: !c.error, detail: c.error ? c.error.message : "finding produced" }),
  eligibility_rejected: (c) => ({ pass: !!(c.error && c.error.code === "not_eligible"), detail: c.error ? `${c.error.code}: ${c.error.message}` : "pipeline ran — the issue was treated as eligible" }),

  // ---- gate / status --------------------------------------------------------
  gate_in: (c, p) => ({ pass: arr(p.values).includes(c.finding.gate.status), detail: c.finding.gate.status }),
  gate_not: (c, p) => ({ pass: !arr(p.values).includes(c.finding.gate.status), detail: c.finding.gate.status }),
  incomplete_detected: (c) => ({ pass: c.finding.gate.status === "incomplete_evidence" || flags(c.finding).has("incomplete_evidence"), detail: `gate ${c.finding.gate.status}; flags ${[...flags(c.finding)].join(",") || "none"}` }),

  // ---- causation ------------------------------------------------------------
  agreement_in: (c, p) => ({ pass: arr(p.values).includes(c.finding.assessment.agreement), detail: c.finding.assessment.agreement }),
  agreement_not: (c, p) => ({ pass: !arr(p.values).includes(c.finding.assessment.agreement), detail: c.finding.assessment.agreement }),
  confidence_max: (c, p) => ({ pass: GRADE[c.finding.confidence] <= GRADE[p.grade], detail: `${c.finding.confidence} (max ${p.grade})` }),
  confidence_min: (c, p) => ({ pass: GRADE[c.finding.confidence] >= GRADE[p.grade], detail: `${c.finding.confidence} (min ${p.grade})` }),
  confidence_not: (c, p) => ({ pass: c.finding.confidence !== p.grade, detail: c.finding.confidence }),
  cause_matches: (c, p) => ({ pass: re(p.pattern).test(c.finding.assessment.likely_cause || ""), detail: c.finding.assessment.likely_cause || "(no cause)" }),
  cause_not_matches: (c, p) => ({ pass: !re(p.pattern).test(c.finding.assessment.likely_cause || ""), detail: c.finding.assessment.likely_cause || "(no cause)" }),
  no_cause_carried: (c) => ({ pass: !c.finding.assessment.likely_cause, detail: c.finding.assessment.likely_cause || "(no cause)" }),
  alternatives_min: (c, p) => ({ pass: (c.finding.assessment.alternative_causes || []).length >= p.n, detail: String((c.finding.assessment.alternative_causes || []).length) }),
  // two plausible causes and a "high" is the anchoring failure this whole suite hunts
  no_definitive_cause_with_alternatives: (c) => {
    const alts = (c.finding.assessment.alternative_causes || []).length;
    const definitive = /\b(definitely|certainly|undoubtedly|beyond (any )?doubt|clearly caused|can only be|must have been caused|conclusively)\b/i.test(texts(c.finding, ["defect", "cause"]));
    const pass = !(alts > 0 && c.finding.confidence === "high") && !definitive;
    return { pass, detail: `${alts} alternative(s), confidence ${c.finding.confidence}${definitive ? ", definitive wording" : ""}` };
  },
  no_definitive_language: (c) => { const m = /\b(definitely|certainly|undoubtedly|beyond (any )?doubt|conclusively|without doubt|proves? that)\b/i.exec(texts(c.finding)); return { pass: !m, detail: m ? `"${m[0]}"` : "" }; },
  hypothesis_not_cited_as_evidence: (c) => {
    const ev = c.finding.evidence || {};
    const bad = [...(ev.observations || []), ...(ev.measurements || [])].filter((o) => (o.source_ids || []).includes("HYP-1"));
    return { pass: !bad.length, detail: bad.length ? bad.map((o) => o.id).join(",") : "" };
  },

  // ---- scope ------------------------------------------------------------------
  scope_in: (c, p) => ({ pass: arr(p.values).includes(c.finding.remedial.scope), detail: c.finding.remedial.scope }),
  scope_not: (c, p) => ({ pass: !arr(p.values).includes(c.finding.remedial.scope), detail: c.finding.remedial.scope }),
  scope_uncertain_or_investigation: (c) => ({ pass: c.finding.remedial.scope === "investigation_first" || flags(c.finding).has("scope_uncertain"), detail: `${c.finding.remedial.scope}; flags ${[...flags(c.finding)].join(",") || "none"}` }),
  no_overreach_wording: (c) => { const m = /\b(the entire|entire ceiling|all walls|all ceilings|throughout the property|whole property|every wall|every room)\b/i.exec(texts(c.finding)); return { pass: !m, detail: m ? `"${m[0]}"` : "" }; },

  // ---- flags / conditions -------------------------------------------------------
  flags_include: (c, p) => { const miss = arr(p.flags).filter((f) => !flags(c.finding).has(f)); return { pass: !miss.length, detail: miss.length ? `missing ${miss.join(",")} (have ${[...flags(c.finding)].join(",") || "none"})` : [...flags(c.finding)].join(",") }; },
  flags_exclude: (c, p) => { const hit = arr(p.flags).filter((f) => flags(c.finding).has(f)); return { pass: !hit.length, detail: hit.join(",") }; },
  conditions_match: (c, p) => ({ pass: re(p.pattern).test((c.finding.remedial.conditions || []).join(" | ")), detail: (c.finding.remedial.conditions || []).join(" | ") || "(none)" }),
  gaps_match: (c, p) => ({ pass: re(p.pattern).test((c.finding.evidence_gaps || []).join(" | ")), detail: (c.finding.evidence_gaps || []).join(" | ") || "(none)" }),

  // ---- legal / HHSRS -----------------------------------------------------------------
  legal_includes: (c, p) => { const miss = arr(p.ids).filter((id) => !legalIds(c.finding).includes(id) && !lower(legalText(c.finding)).includes(lower(id))); return { pass: !miss.length, detail: legalIds(c.finding).join(",") || "(none)" }; },
  legal_excludes: (c, p) => { const hit = arr(p.ids).filter((id) => legalIds(c.finding).includes(id) || lower(legalText(c.finding)).includes(lower(id))); return { pass: !hit.length, detail: legalIds(c.finding).join(",") || "(none)" }; },
  legal_empty: (c) => ({ pass: !legalIds(c.finding).length, detail: legalIds(c.finding).join(",") || "(none)" }),
  legal_only_registered: (c) => { const bad = legalIds(c.finding).filter((id) => !c.ref.legal.byId[id]); return { pass: !bad.length, detail: bad.join(",") }; },
  // statute wording in the prose must correspond to a resolved register entry;
  // a sentence that is plainly quoting a source (caption, note, what was said)
  // is reporting evidence, not citing law
  no_statute_text_outside_refs: (c) => {
    const refsText = lower(legalText(c.finding) + " " + (c.finding.legislation || []).join(" "));
    const quoting = /caption|quoted|read[s]?\b|stated|said|wrote|recorded as|["“”']/i;
    const problems = [];
    for (const s of sentences(texts(c.finding))) {
      if (quoting.test(s)) continue;
      for (const m of s.matchAll(/\b(?:section|s\.)\s?(\d+[A-Za-z]?)\b/gi)) if (!refsText.includes(lower(m[1]))) problems.push(m[0]);
      for (const m of s.matchAll(/\b([A-Z][A-Za-z()]+(?: [A-Za-z()]+){0,6} Act) (\d{4})\b/g)) if (!refsText.includes(m[2])) problems.push(`${m[1]} ${m[2]}`);
    }
    return { pass: !problems.length, detail: problems.join("; ") };
  },
  hazard_in: (c, p) => ({ pass: arr(p.ids).includes(hazardId(c.finding)), detail: hazardId(c.finding) }),
  hazard_not: (c, p) => ({ pass: !arr(p.ids).includes(hazardId(c.finding)), detail: hazardId(c.finding) }),
  hazard_category_not: (c, p) => ({ pass: !c.finding.hazard || c.finding.hazard.category !== p.category, detail: c.finding.hazard ? `${c.finding.hazard.id} ${c.finding.hazard.category}` : "none" }),
  hazard_review_required_if: (c, p) => ({ pass: hazardId(c.finding) !== p.id || !!(c.finding.hazard && c.finding.hazard.review_required), detail: c.finding.hazard ? `${c.finding.hazard.id} confidence ${c.finding.hazard.confidence}` : "none" }),

  // ---- pricing ------------------------------------------------------------------------
  price_rows_include: (c, p) => { const miss = arr(p.rows).filter((r) => !rowIds(c.finding).has(r)); return { pass: !miss.length, detail: [...rowIds(c.finding)].join(",") || "(none)" }; },
  price_rows_exclude: (c, p) => { const hit = arr(p.rows).filter((r) => rowIds(c.finding).has(r)); return { pass: !hit.length, detail: hit.join(",") }; },
  no_price_rows: (c) => ({ pass: !rowIds(c.finding).size, detail: [...rowIds(c.finding)].join(",") || "(none)" }),
  row_not_priced: (c, p) => ({ pass: !priced(c.finding).some((l) => l.row_id === p.row), detail: priced(c.finding).map((l) => `${l.row_id}×${l.qty}`).join(",") || "(nothing priced)" }),
  unpriced: (c, p) => ({ pass: !!c.finding.cost.unpriced === (p.value !== false), detail: c.finding.cost.unpriced ? "unpriced" : `£${c.finding.cost.low}–£${c.finding.cost.high}` }),
  // a priced row's own low figure — the book's minimum for that work (passes when the row is not priced; pair with price_rows_include)
  line_low_min: (c, p) => { const l = priced(c.finding).find((x) => x.row_id === p.row); return { pass: !l || l.low >= p.value, detail: l ? `${l.row_id} low £${l.low}` : `${p.row} not priced` }; },
  line_quantity: (c, p) => { const l = priced(c.finding).find((x) => x.row_id === p.row); return { pass: !!l && l.qty === p.qty, detail: l ? `${l.row_id}×${l.qty} (${l.qtySource})` : "row not priced" }; },
  cost_low_min: (c, p) => ({ pass: !c.finding.cost.unpriced && c.finding.cost.low >= p.value, detail: c.finding.cost.unpriced ? "unpriced" : `low £${c.finding.cost.low}` }),
  cost_high_max: (c, p) => ({ pass: !c.finding.cost.unpriced && c.finding.cost.high <= p.value, detail: c.finding.cost.unpriced ? "unpriced" : `high £${c.finding.cost.high}` }),
  cost_range: (c, p) => ({ pass: !c.finding.cost.unpriced && c.finding.cost.low === p.low && c.finding.cost.high === p.high, detail: c.finding.cost.unpriced ? "unpriced" : `£${c.finding.cost.low}–£${c.finding.cost.high}` }),
  // every priced line rests on an evidenced or entered quantity, or is an assumption the surveyor is told about
  priced_lines_evidenced: (c) => {
    const bad = priced(c.finding).filter((l) => !(["observed", "stated", "surveyor"].includes(l.qtySource) || (l.qtySource === "assumed" && flags(c.finding).has("price_assumption"))));
    return { pass: !bad.length, detail: bad.map((l) => `${l.row_id} ${l.qtySource}`).join(",") };
  },
  if_row_then: (c, p) => {
    if (!rowIds(c.finding).has(p.row)) return { pass: true, detail: `${p.row} not used` };
    const ok = arr(p.then_rows_any).some((r) => rowIds(c.finding).has(r)) || arr(p.or_scope).includes(c.finding.remedial.scope);
    return { pass: ok, detail: `${p.row} with ${[...rowIds(c.finding)].join(",")}; scope ${c.finding.remedial.scope}` };
  },
  // a figure in the prose that is not the server's own total is an invented authoritative price
  money_in_text_matches_cost: (c) => {
    const found = [...texts(c.finding).matchAll(/£\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    const ok = found.every((n) => !c.finding.cost.unpriced && (n === c.finding.cost.low || n === c.finding.cost.high));
    return { pass: ok, detail: found.length ? `£${found.join(", £")} vs cost ${c.finding.cost.unpriced ? "unpriced" : `£${c.finding.cost.low}–£${c.finding.cost.high}`}` : "no figures in prose" };
  },

  // ---- prose ------------------------------------------------------------------------------
  text_matches: (c, p) => ({ pass: re(p.pattern).test(texts(c.finding, p.where)), detail: "" }),
  text_not_matches: (c, p) => { const m = re(p.pattern).exec(texts(c.finding, p.where)); return { pass: !m, detail: m ? `"${m[0]}"` : "" }; },
  // a sentence may contain the pattern only when it also carries an attribution
  text_not_matches_unless: (c, p) => {
    const unless = re(p.unless || "(reported|stated|said|told|according to|occupier|tenant|claimed|described)");
    const bad = sentences(texts(c.finding, p.where)).filter((s) => re(p.pattern).test(s) && !unless.test(s));
    return { pass: !bad.length, detail: bad.length ? `"${bad[0].slice(0, 140)}"` : "" };
  },
  no_invented_duration: (c, p) => {
    const dur = /\b(?:several|many|a few|numerous|\d+|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen)\s+(?:days?|weeks?|months?|years?)\b|\bsince (?:19|20)\d\d\b|\b(?:long-?standing|of long standing)\b/i;
    const unless = re(p.unless || "(reported|stated|said|told|according to|occupier|tenant|claimed|described|recorded on)");
    const bad = sentences(texts(c.finding, p.where)).filter((s) => dur.test(s) && !unless.test(s));
    return { pass: !bad.length, detail: bad.length ? `"${bad[0].slice(0, 140)}"` : "" };
  },
  // any dimension in the prose must appear somewhere a person recorded it
  no_invented_dimensions: (c) => {
    const src = numbersIn(sourceText(c));
    const bad = [...texts(c.finding).matchAll(/\b(\d+(?:\.\d+)?)\s*(?:m²|m2|sq\.?\s?m|square met|mm|cm|metres?|meters?|m\b|ft|feet|inch(?:es)?)/gi)].filter((m) => !src.has(m[1]));
    return { pass: !bad.length, detail: bad.map((m) => m[0]).join(", ") };
  },
  asbestos_not_ruled_out: (c) => { const m = /\b(no|free of|free from|does not contain|doesn't contain|absence of|not contain(?:ing)?|without|not) asbestos\b|asbestos[- ]free|\bnot asbestos\b|tested negative/i.exec(texts(c.finding)); return { pass: !m, detail: m ? `"${m[0]}"` : "" }; },

  // ---- evidence integrity -----------------------------------------------------------------------
  no_unknown_source_ids: (c) => {
    const known = new Set(Object.keys(c.finding.evidence.sources || {}));
    const bad = [...(c.finding.evidence.observations || []), ...(c.finding.evidence.measurements || [])].flatMap((o) => (o.source_ids || []).filter((s) => !known.has(s) && !/^(OBS|STMT|MEAS)-/.test(s)).map((s) => `${o.id}→${s}`));
    return { pass: !bad.length, detail: bad.join(",") };
  },
  photo_refs_valid: (c) => {
    const nos = new Set(Object.values(c.finding.evidence.sources || {}).filter((s) => s.type === "photo").map((s) => s.no));
    const bad = (c.finding.photo_refs || []).filter((n) => !nos.has(n));
    return { pass: !bad.length, detail: bad.join(",") };
  },
  photo_refs_subset: (c, p) => { const bad = (c.finding.photo_refs || []).filter((n) => !arr(p.exhibits).includes(n)); return { pass: !bad.length, detail: `refs ${(c.finding.photo_refs || []).join(",") || "none"}` }; },
  sources_subset: (c, p) => { const bad = Object.keys(c.finding.evidence.sources || {}).filter((id) => !arr(p.ids).includes(id) && !/^HYP-/.test(id)); return { pass: !bad.length, detail: bad.join(",") }; },
  source_present: (c, p) => ({ pass: !!(c.finding.evidence.sources || {})[p.id], detail: Object.keys(c.finding.evidence.sources || {}).join(",") }),
  source_absent: (c, p) => ({ pass: !(c.finding.evidence.sources || {})[p.id], detail: Object.keys(c.finding.evidence.sources || {}).join(",") }),
  statement_recorded: (c, p) => ({ pass: (c.finding.evidence.statements || []).some((s) => re(p.pattern).test(s.statement)), detail: String((c.finding.evidence.statements || []).length) + " statements" }),
  unreadable_recorded: (c, p) => ({ pass: (c.finding.evidence.unreadable || []).some((u) => !p.id || u.source_id === p.id), detail: (c.finding.evidence.unreadable || []).map((u) => u.source_id).join(",") || "(none)" }),

  // ---- pipeline structure (Category B) ----------------------------------------------------------------
  evidence_batches_min: (c, p) => ({ pass: ((c.run.evidence || {}).evidenceBatches || 0) >= p.n, detail: `${(c.run.evidence || {}).evidenceBatches || 0} batch(es)` }),
  photos_analysed_equals: (c, p) => ({ pass: (c.run.evidence || {}).photosAnalysed === p.n, detail: `${(c.run.evidence || {}).photosAnalysed} analysed` }),
  all_photos_in_sources: (c) => {
    const nos = new Set(Object.values(c.finding.evidence.sources || {}).filter((s) => s.type === "photo").map((s) => s.no));
    const missing = c.input.photos.map((p) => p.no).filter((n) => !nos.has(n));
    return { pass: !missing.length, detail: missing.length ? `exhibits ${missing.join(",")} missing from sources` : `${nos.size} photos in sources` };
  },
  every_photo_cited_or_unreadable: (c) => {
    const cited = new Set((c.finding.evidence.observations || []).flatMap((o) => o.source_ids).filter((s) => s.startsWith("PHOTO-")));
    const unreadable = new Set((c.finding.evidence.unreadable || []).map((u) => u.source_id));
    const missed = c.input.photos.map((p) => `PHOTO-${p.no}`).filter((id) => !cited.has(id) && !unreadable.has(id));
    return { pass: !missed.length, detail: missed.length ? `${missed.join(",")} neither cited nor marked unreadable` : "" };
  },

  // ---- verification -------------------------------------------------------------------------------
  verification_claims_min: (c, p) => ({ pass: claims(c.finding).length >= (p.n || 1), detail: String(claims(c.finding).length) }),
  verification_claim: (c, p) => {
    const hit = claims(c.finding).find((k) => re(p.pattern).test(k.claim + " " + k.note) && (!p.type_in || arr(p.type_in).includes(k.type)) && (!p.support_in || arr(p.support_in).includes(k.support)));
    return { pass: !!hit, detail: hit ? `${hit.type}/${hit.support}: ${hit.claim.slice(0, 100)}` : "no matching claim" };
  },
  no_contradicted_claim_reaches_review_ready: (c) => {
    const bad = claims(c.finding).filter((k) => k.support === "contradicted" || (k.support === "unsupported" && MATERIAL.has(k.type)));
    return { pass: !bad.length || c.finding.gate.status === "blocked", detail: bad.length ? `${bad.length} material problem(s), gate ${c.finding.gate.status}` : "none" };
  },
};

// invariants every pipeline case is held to, whatever its own rules say
export const INVARIANTS = [
  { rule: "no_unknown_source_ids", severity: "critical", label: "every observation cites a real source" },
  { rule: "photo_refs_valid", severity: "critical", label: "every exhibit cited exists in this issue" },
  { rule: "hypothesis_not_cited_as_evidence", severity: "critical", label: "the surveyor's hypothesis is never an evidence source" },
  { rule: "legal_only_registered", severity: "critical", label: "legal references come from the register" },
  { rule: "no_statute_text_outside_refs", severity: "critical", label: "no statute named in prose without a register entry" },
  { rule: "money_in_text_matches_cost", severity: "critical", label: "no price in prose other than the server's total" },
  { rule: "priced_lines_evidenced", severity: "critical", label: "every priced quantity is evidenced, entered or a flagged assumption" },
  { rule: "no_contradicted_claim_reaches_review_ready", severity: "critical", label: "material contradiction blocks the finding" },
  { rule: "asbestos_not_ruled_out", severity: "critical", label: "asbestos never ruled out in prose" },
  { rule: "no_invented_duration", severity: "critical", label: "no duration the evidence does not carry" },
  { rule: "no_invented_dimensions", severity: "critical", label: "no dimension the evidence does not carry" },
  { rule: "no_definitive_language", severity: "major", label: "no absolute certainty wording" },
  { rule: "no_overreach_wording", severity: "major", label: "no over-reaching scope wording" },
  { rule: "verification_claims_min", severity: "major", label: "the verifier produced claims", n: 1 },
];

// `expected` is a shorthand: key → rule name, value → parameter
const EXPECTED_MAP = {
  gate_in: (v) => ({ rule: "gate_in", values: v }), gate_not: (v) => ({ rule: "gate_not", values: v }),
  agreement_in: (v) => ({ rule: "agreement_in", values: v }), agreement_not: (v) => ({ rule: "agreement_not", values: v }),
  confidence_max: (v) => ({ rule: "confidence_max", grade: v }), confidence_min: (v) => ({ rule: "confidence_min", grade: v }),
  cause_matches: (v) => ({ rule: "cause_matches", pattern: v }), cause_not_matches: (v) => ({ rule: "cause_not_matches", pattern: v }),
  alternatives_min: (v) => ({ rule: "alternatives_min", n: v }),
  scope_in: (v) => ({ rule: "scope_in", values: v }), scope_not: (v) => ({ rule: "scope_not", values: v }),
  flags_include: (v) => ({ rule: "flags_include", flags: v }), flags_exclude: (v) => ({ rule: "flags_exclude", flags: v }),
  legal_includes: (v) => ({ rule: "legal_includes", ids: v }), legal_excludes: (v) => ({ rule: "legal_excludes", ids: v }), legal_empty: () => ({ rule: "legal_empty" }),
  hazard_in: (v) => ({ rule: "hazard_in", ids: v }), hazard_not: (v) => ({ rule: "hazard_not", ids: v }),
  price_rows_include: (v) => ({ rule: "price_rows_include", rows: v }), price_rows_exclude: (v) => ({ rule: "price_rows_exclude", rows: v }),
  unpriced: (v) => ({ rule: "unpriced", value: v }), no_price_rows: () => ({ rule: "no_price_rows" }),
  cost_low_min: (v) => ({ rule: "cost_low_min", value: v }), cost_high_max: (v) => ({ rule: "cost_high_max", value: v }),
  conditions_match: (v) => ({ rule: "conditions_match", pattern: v }), gaps_match: (v) => ({ rule: "gaps_match", pattern: v }),
  text_matches: (v) => ({ rule: "text_matches", pattern: v }),
  eligibility_rejected: () => ({ rule: "eligibility_rejected" }), incomplete_detected: () => ({ rule: "incomplete_detected" }),
  scope_uncertain_or_investigation: () => ({ rule: "scope_uncertain_or_investigation" }),
  statement_recorded: (v) => ({ rule: "statement_recorded", pattern: v }),
  verification_claim: (v) => ({ rule: "verification_claim", ...v }),
  verification_claims_min: (v) => ({ rule: "verification_claims_min", n: typeof v === "object" ? v.n : v }),
  evidence_batches_min: (v) => ({ rule: "evidence_batches_min", n: v }), photos_analysed_equals: (v) => ({ rule: "photos_analysed_equals", n: v }),
  all_photos_in_sources: () => ({ rule: "all_photos_in_sources" }), every_photo_cited_or_unreadable: () => ({ rule: "every_photo_cited_or_unreadable" }),
  unreadable_recorded: (v) => ({ rule: "unreadable_recorded", id: typeof v === "string" ? v : undefined }),
  hazard_category_not: (v) => ({ rule: "hazard_category_not", category: v }),
  source_absent: (v) => ({ rule: "source_absent", id: v }), source_present: (v) => ({ rule: "source_present", id: v }),
};

export function expectedToRules(expected = {}) {
  const out = [];
  for (const [k, v] of Object.entries(expected)) {
    const f = EXPECTED_MAP[k];
    let spec;
    if (f) spec = f(v);
    // any parameterless rule may be named directly with `true`; a rule with
    // parameters may be named with its parameter object
    else if (RULES[k] && v === true) spec = { rule: k };
    else if (RULES[k] && v && typeof v === "object" && !Array.isArray(v)) spec = { rule: k, ...v };
    else throw new Error(`unknown expected key "${k}"`);
    out.push({ ...spec, severity: "major", label: `expected ${k}${v !== undefined && v !== true && typeof v !== "object" ? ` ${v}` : Array.isArray(v) ? ` [${v.join(",")}]` : ""}` });
  }
  return out;
}

export function validateRuleSpecs(specs, where) {
  for (const s of specs) {
    if (!s || !RULES[s.rule]) throw new Error(`${where}: unknown rule "${s && s.rule}"`);
    if (s.severity && !["critical", "major", "minor"].includes(s.severity)) throw new Error(`${where}: bad severity "${s.severity}" on ${s.rule}`);
  }
}

// runs one spec; an error-state case only evaluates the outcome rules
export function evaluate(spec, ctx) {
  const outcomeOnly = new Set(["pipeline_succeeded", "eligibility_rejected"]);
  if (ctx.error && !outcomeOnly.has(spec.rule)) return { ...spec, pass: false, skipped: true, detail: `no finding (${ctx.error.code || "error"})` };
  if (!ctx.error && spec.rule === "eligibility_rejected") return { ...spec, pass: false, detail: "pipeline ran — the issue was treated as eligible" };
  try {
    const r = RULES[spec.rule](ctx, spec);
    return { ...spec, pass: !!r.pass, detail: r.detail || "" };
  } catch (e) {
    return { ...spec, pass: false, detail: `rule threw: ${e.message}` };
  }
}

export { texts, MATERIAL };
