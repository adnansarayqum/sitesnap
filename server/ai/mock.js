// Deterministic stand-ins for every model stage: shaped exactly like a real
// reply, derived from the packet so tests can steer them, and honest about
// being mocks wherever prose reaches a person. Used with AI_MOCK=1 and by the
// unit tests.
const damp = (s) => /damp|mould|mold|condensation|leak|staining|tide/i.test(s);

export function mockEvidence(packet, batch, first) {
  const observations = batch.map((p, i) => ({
    id: `OBS-${String(i + 1).padStart(3, "0")}`,
    statement: `[MOCK] ${p.caption ? p.caption : `Defect visible in exhibit ${p.no}`} was observed.`,
    source_ids: [p.id, ...(p.caption && p.captionBy !== "ai" ? [`CAPTION-${p.no}`] : [])],
    source_type: "photo", certainty: p.caption ? "high" : "medium",
  }));
  const statements = [];
  const measurements = [];
  if (first) {
    if (packet.note) statements.push({ id: "STMT-001", statement: `[MOCK] Surveyor noted: ${packet.note.text.slice(0, 160)}`, source_ids: ["NOTE-1"], asserts_cause: /condensation|leak|cause/i.test(packet.note.text) });
    if (packet.desc) statements.push({ id: `STMT-${String(statements.length + 1).padStart(3, "0")}`, statement: `[MOCK] Issue described as: ${packet.desc.text.slice(0, 160)}`, source_ids: ["DESC-1"], asserts_cause: false });
    packet.memos.filter((m) => m.text).forEach((m) => statements.push({ id: `STMT-${String(statements.length + 1).padStart(3, "0")}`, statement: `[MOCK] Said on the recording: ${m.text.slice(0, 160)}`, source_ids: [m.id], asserts_cause: /condensation|leak|cause|because/i.test(m.text) }));
    packet.readings.forEach((r, i) => measurements.push({ id: `MEAS-${String(i + 1).padStart(3, "0")}`, statement: `[MOCK] ${r.text}`, value: r.value, unit: r.unit, source_ids: [r.id] }));
    for (const m of [...(packet.note ? [packet.note.text] : []), ...packet.memos.map((x) => x.text || "")]) {
      const mm = /(\d+(?:\.\d+)?)\s*%/.exec(m);
      if (mm && !measurements.length) measurements.push({ id: "MEAS-001", statement: `[MOCK] A moisture reading of ${mm[1]}% was recorded.`, value: `${mm[1]}%`, unit: "%", source_ids: [packet.note && packet.note.text.includes(mm[0]) ? "NOTE-1" : packet.memos.find((x) => (x.text || "").includes(mm[0]))?.id || "NOTE-1"] });
    }
  }
  return { observations, statements, measurements, unreadable_sources: [], evidence_gaps: packet.photos.length ? [] : ["[MOCK] No photographs of the affected area."] };
}

export function mockCausation(packet, evidence) {
  const said = [packet.note ? packet.note.text : "", packet.desc ? packet.desc.text : "", ...packet.memos.map((m) => m.text || ""), ...evidence.observations.map((o) => o.statement)].join(" ");
  const isDamp = damp(said);
  const obs = evidence.observations.map((o) => o.id);
  const leakWords = /blister|staining|tide|opposite|leak/i.test(said);
  return {
    defect_summary: isDamp ? "[MOCK] Mould and damp staining to the surfaces recorded." : "[MOCK] A defect to the element recorded.",
    candidate_causes: isDamp ? [
      { cause: "surface condensation", supporting_observations: obs.slice(0, 2), contrary_observations: leakWords ? obs.slice(2, 3) : [], confidence: evidence.measurements.length ? "medium" : "low", distinguishing_evidence: "Deep moisture profile reading; extractor test." },
      { cause: "penetrating damp from a concealed leak", supporting_observations: leakWords ? obs.slice(2, 3) : [], contrary_observations: [], confidence: leakWords ? "medium" : "low", distinguishing_evidence: "Readings deep in the substrate below the fitting." },
    ] : [{ cause: "not established from the evidence", supporting_observations: [], contrary_observations: [], confidence: "low", distinguishing_evidence: "A photograph of the extent and a reading." }],
    preferred_cause: isDamp ? "surface condensation" : "",
    confidence: isDamp ? (evidence.measurements.length ? "medium" : "low") : "low",
    reasoning: "[MOCK] The real model weighs the photographs and readings here.",
    evidence_gaps: evidence.measurements.length ? [] : ["[MOCK] No moisture profile reading available."],
    asbestos_risk: { present: /artex|textured/i.test(said), basis: /artex|textured/i.test(said) ? "[MOCK] A textured coating is recorded." : "" },
  };
}

export function mockAnalysis(packet, evidence, causation, lists) {
  const hyp = (packet.hypothesis || "").toLowerCase();
  const pref = (causation.preferred_cause || "").toLowerCase();
  let agreement = "no_hypothesis";
  if (hyp) agreement = !pref ? "uncertain" : (/leak|penetrat/.test(hyp) && /condensation/.test(pref)) || (/condensation/.test(hyp) && /leak/.test(pref)) ? "disagree" : /condensation/.test(hyp) && /condensation/.test(pref) ? "agree" : "uncertain";
  const isDamp = !!pref;
  const legalIds = lists.legal.map((l) => l.id);
  const rowIds = lists.price_rows.map((r) => r.id);
  const pick = (id) => (rowIds.includes(id) ? id : null);
  const priceItems = [];
  if (isDamp && pick("MOULD-WALL")) priceItems.push({ price_book_row_id: "MOULD-WALL", quantity: 1, quantity_basis: "assumed", quantity_evidence: [], reason: "[MOCK] one wall area" });
  if (isDamp && /extractor|fan/i.test([packet.note && packet.note.text, ...packet.memos.map((m) => m.text)].join(" ")) && pick("EXTRACT-FAN-REPLACE")) priceItems.push({ price_book_row_id: "EXTRACT-FAN-REPLACE", quantity: 1, quantity_basis: "stated", quantity_evidence: [packet.note ? "NOTE-1" : packet.memos[0] ? packet.memos[0].id : "NOTE-1"], reason: "[MOCK] extractor reported not working" });
  const all = packet.photos.map((p) => p.id);
  return {
    comparison: { agreement, reasoning: "[MOCK] comparison reasoning.", differences: agreement === "disagree" ? ["[MOCK] the surveyor's cause and the evidenced cause differ"] : [], evidence_supporting_surveyor: agreement === "agree" ? all.slice(0, 1) : [], evidence_contradicting_surveyor: agreement === "disagree" ? all.slice(0, 1) : [], attention_required: !["agree", "no_hypothesis"].includes(agreement) },
    extent: { statement: packet.photos.length ? "[MOCK] Extent judged from the photographs." : "[MOCK] Extent cannot be judged.", source_ids: all.slice(0, 2), certainty: packet.photos.length ? "medium" : "low" },
    remedial: {
      works: isDamp ? "[MOCK] The mould-affected areas should be cleaned and treated with an appropriate fungicidal treatment; defective finishes prepared, stain-blocked and redecorated with a moisture-resistant paint system." : "[MOCK] To be confirmed on review.",
      scope: packet.photos.length ? "localised" : "investigation_first", scope_rationale: "[MOCK] scope rationale.", scope_uncertain: !packet.photos.length, conditions: causation.asbestos_risk.present ? ["subject to asbestos sampling and results"] : [], assumptions: [],
    },
    legal_refs: isDamp ? [{ legal_register_id: legalIds.includes("LEGAL-S9A-LTA") ? "LEGAL-S9A-LTA" : legalIds[0], reason: "[MOCK] fitness — freedom from damp" }, { legal_register_id: legalIds.includes("LEGAL-S10-LTA") ? "LEGAL-S10-LTA" : legalIds[0], reason: "[MOCK] the matter: freedom from damp, ventilation" }].filter((x) => x.legal_register_id) : [],
    hhsrs: isDamp ? { hazard_id: "HHSRS-01", category: "Cat 2", evidence_basis: "[MOCK] mould growth recorded", confidence: "medium" } : { hazard_id: "none", category: "none", evidence_basis: "", confidence: "low" },
    price_items: priceItems,
    pricing_note: priceItems.length ? "" : "[MOCK] no row fits a mock finding",
  };
}

export function mockDraft(packet, inputs) {
  const c = inputs.causation;
  return {
    title: c.preferred_cause ? `Damp and mould to ${packet.context.room.toLowerCase()}` : `Defect noted to ${packet.context.room.toLowerCase()}`,
    location: packet.issue.title || packet.context.room,
    defect: `[MOCK DRAFT — no ANTHROPIC_API_KEY] ${inputs.observations.map((o) => o.statement.replace(/^\[MOCK\] /, "")).join(" ") || "A defect was observed at the time of inspection."}`,
    cause: c.preferred_cause ? `[MOCK] On the balance of probabilities the cause is considered to be ${c.preferred_cause} (confidence ${inputs.confidence.grade}).` : "",
    works: `[MOCK] ${inputs.remedial.works.replace(/^\[MOCK\] /, "")}${inputs.remedial.conditions.length ? ` (${inputs.remedial.conditions.join("; ")})` : ""}`,
    photo_refs: packet.photos.slice(0, 3).map((p) => p.no),
  };
}

export function mockVerify(packet, evidence, candidate) {
  // every observation in the draft is supported by construction; a test can
  // plant an unsupported claim by putting "[UNSUPPORTED]" in the issue description
  const claims = evidence.observations.map((o) => ({ claim: o.statement, type: "observation", support: "supported", source_ids: o.source_ids, severity: "none", note: "" }));
  if (packet.desc && /\[UNSUPPORTED\]/.test(packet.desc.text)) claims.push({ claim: "[MOCK] a measurement that appears in no source", type: "measurement", support: "unsupported", source_ids: [], severity: "block", note: "[MOCK] planted by the test" });
  if (packet.desc && /\[CONTRADICTED\]/.test(packet.desc.text)) claims.push({ claim: "[MOCK] the ceiling was dry", type: "observation", support: "contradicted", source_ids: evidence.observations.slice(0, 1).map((o) => o.id), severity: "block", note: "[MOCK] the photographs show staining" });
  if (candidate.cause) claims.push({ claim: candidate.cause, type: "causation", support: "partially_supported", source_ids: evidence.observations.slice(0, 1).map((o) => o.id), severity: "review", note: "[MOCK] causation is an inference" });
  return { claims, summary: "[MOCK] verification summary." };
}

export function mockCluster(packet) {
  const photos = packet.photos;
  const half = Math.ceil(photos.length / 2);
  const issues = [];
  if (photos.length) issues.push({ title: "[MOCK] Issue A", photo_ids: photos.slice(0, half).map((p) => p.id), memo_ids: packet.memos.slice(0, 1).map((m) => m.id), confidence: "medium", rationale: "[MOCK] first half of the photographs" });
  if (photos.length > 1) issues.push({ title: "[MOCK] Issue B", photo_ids: photos.slice(half, photos.length - (photos.length > 2 ? 1 : 0)).map((p) => p.id), memo_ids: packet.memos.slice(1, 2).map((m) => m.id), confidence: "low", rationale: "[MOCK] second half" });
  const uncertain = photos.length > 2 ? [{ id: photos[photos.length - 1].id, reason: "[MOCK] could belong to either" }] : [];
  return { issues, uncertain, room_level: [] };
}
