// JSON Schemas the API enforces on each stage's reply. Kept to the subset
// structured outputs accept exactly (types, enums, required,
// additionalProperties). Where a stage must pick from a controlled list —
// legal entries, HHSRS hazards, price rows — the list is baked into the
// schema as an enum, so the model cannot name an id that does not exist;
// the server still validates afterwards.
const S = (type, extra = {}) => ({ type, ...extra });
export const str = (description) => S("string", description ? { description } : {});
export const num = (description) => S("number", description ? { description } : {});
export const bool = (description) => S("boolean", description ? { description } : {});
export const arr = (items, description) => S("array", { items, ...(description ? { description } : {}) });
export const en = (values, description) => S("string", { enum: values, ...(description ? { description } : {}) });
export const obj = (properties, description) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) });

const ids = (d) => arr(str(), d);
const CERTAINTY = ["high", "medium", "low"];

export const EVIDENCE_SCHEMA = obj({
  observations: arr(obj({
    id: str("OBS-001, OBS-002 … in order."),
    statement: str("What was observed, plainly, past tense. No cause."),
    source_ids: ids("Evidence ids this rests on (PHOTO-n, MEMO-n, NOTE-1, READING-n, CAPTION-n)."),
    source_type: en(["photo", "transcript", "note", "reading", "caption", "mixed"]),
    certainty: en(CERTAINTY),
  })),
  statements: arr(obj({
    id: str("STMT-001 …"),
    statement: str("A factual thing the surveyor wrote or said, paraphrased closely."),
    source_ids: ids(),
    asserts_cause: bool("True when the statement names or implies a cause — it is then kept for the comparison step, not the blind assessment."),
  }), "What the surveyor wrote or said (note, voice notes), separated from what the photographs show."),
  measurements: arr(obj({
    id: str("MEAS-001 …"),
    statement: str(),
    value: str("The figure as recorded, e.g. '4.5%' — empty if none was given."),
    unit: str("Empty if none."),
    source_ids: ids(),
  })),
  unreadable_sources: arr(obj({ source_id: str(), reason: str() })),
  evidence_gaps: arr(str(), "What is missing that would matter: a reading, a photo of the extent, the other side of a wall."),
});

export const CAUSATION_SCHEMA = obj({
  defect_summary: str("One sentence: what the evidence shows is wrong, without a cause."),
  candidate_causes: arr(obj({
    cause: str(),
    supporting_observations: ids("OBS/MEAS ids for it."),
    contrary_observations: ids("OBS/MEAS ids against it."),
    confidence: en(CERTAINTY),
    distinguishing_evidence: str("What would settle it against the others."),
  })),
  preferred_cause: str("The most probable cause on the balance of probabilities. Empty if the evidence cannot carry one."),
  confidence: en(CERTAINTY),
  reasoning: str("The evidence for and against, briefly, citing ids."),
  evidence_gaps: arr(str()),
  asbestos_risk: obj({ present: bool(), basis: str("Why — the coating, board or material seen, and the dwelling's age if known. Empty if not present.") }),
});

export function analysisSchema({ legalIds, hazardIds, priceRowIds }) {
  return obj({
    comparison: obj({
      agreement: en(["agree", "disagree", "uncertain", "no_hypothesis"]),
      reasoning: str(),
      differences: arr(str(), "Where the two views part, one per line."),
      evidence_supporting_surveyor: ids(),
      evidence_contradicting_surveyor: ids(),
      attention_required: bool("True unless agreement is agree or no_hypothesis."),
    }),
    extent: obj({
      statement: str("How much of the element is affected, from the photographs."),
      source_ids: ids(),
      certainty: en(CERTAINTY),
    }),
    remedial: obj({
      works: str("The works reasonably required, in the firm's register."),
      scope: en(["localised", "whole_element", "multiple_elements", "investigation_first"]),
      scope_rationale: str(),
      scope_uncertain: bool("True when the extent cannot be judged well enough to fix the scope."),
      conditions: arr(str(), "E.g. 'subject to asbestos sampling and results'."),
      assumptions: arr(str(), "What the works assume that the evidence does not settle."),
    }),
    legal_refs: arr(obj({
      legal_register_id: en(legalIds.length ? legalIds : ["none"]),
      reason: str("Why this entry applies to this defect."),
    }), "Empty when the evidence does not clearly support a breach."),
    hhsrs: obj({
      hazard_id: en([...hazardIds, "none"]),
      category: en(["Cat 1", "Cat 2", "none"]),
      evidence_basis: str(),
      confidence: en(CERTAINTY),
    }),
    price_items: arr(obj({
      price_book_row_id: en(priceRowIds.length ? priceRowIds : ["none"]),
      quantity: num("Whole units for count rows; m² or m for measure rows. 0 when unknown."),
      quantity_basis: en(["observed", "stated", "assumed", "unknown"]),
      quantity_evidence: ids("Source ids for an observed or stated quantity; empty otherwise."),
      reason: str(),
    })),
    pricing_note: str("Why a line was left out, or what the surveyor must supply. Empty if nothing to say."),
  });
}

export const DRAFT_SCHEMA = obj({
  title: str("Short label for the schedule, e.g. 'Damp and mould to wall adjacent to bath'."),
  location: str("Where in the room, in the surveyor's terms."),
  defect: str("The observation paragraph, court-facing."),
  cause: str("The causation paragraph, at the validated confidence. Empty if no cause was carried."),
  works: str("The remedial works paragraph, at the validated scope, with the conditions."),
  photo_refs: arr(S("integer"), "Exhibit numbers relied on."),
});

export const VERIFY_SCHEMA = obj({
  claims: arr(obj({
    claim: str(),
    type: en(["observation", "measurement", "history", "causation", "extent", "remedial", "legal", "cost", "other"]),
    support: en(["supported", "partially_supported", "unsupported", "contradicted", "not_applicable"]),
    source_ids: ids(),
    severity: en(["none", "review", "block"]),
    note: str("One line: why, citing ids. Empty when supported."),
  })),
  summary: str("One or two sentences for the surveyor."),
});

export const CAPTION_SCHEMA = obj({
  photos: arr(obj({
    id: str("The photo id exactly as supplied."),
    caption: str("Short factual caption — what is visible, not a diagnosis."),
  }), "One entry per photo supplied, same id and order."),
  room_note: str("A short descriptive room note the surveyor can adopt, or empty."),
});

export const CLUSTER_SCHEMA = obj({
  issues: arr(obj({
    title: str("Two to five words, e.g. 'Ceiling mould'."),
    photo_ids: ids("PHOTO-n ids."),
    memo_ids: ids("MEMO-n ids."),
    confidence: en(CERTAINTY),
    rationale: str(),
  })),
  uncertain: arr(obj({ id: str(), reason: str() })),
  room_level: arr(obj({ id: str(), reason: str() }), "Evidence that is about the room generally, not one defect."),
});
