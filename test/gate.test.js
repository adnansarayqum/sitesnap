// The deterministic rules that decide review-ready / blocked / incomplete,
// and the confidence grade as a property of the evidence.
import { describe, expect, it } from "vitest";
import { computeConfidence, decideGate, validateIds } from "../server/ai/gate.js";

const packet = (over = {}) => ({ sources: { "PHOTO-1": { type: "photo" }, "PHOTO-2": { type: "photo" }, "NOTE-1": { type: "note" } }, photos: [{ id: "PHOTO-1", no: 1 }, { id: "PHOTO-2", no: 2 }], memos: [], complete: true, incomplete: [], unconfirmedLinks: [], context: { builtPre2000: null }, ...over });
const evidence = { observations: [{ id: "OBS-001", statement: "x", source_ids: ["PHOTO-1", "PHOTO-2"] }], statements: [], measurements: [{ id: "MEAS-001", statement: "4.5%", source_ids: ["NOTE-1"] }] };
const causation = { preferred_cause: "condensation", confidence: "high", candidate_causes: [{ cause: "condensation", supporting_observations: ["OBS-001"], contrary_observations: [], confidence: "high" }] };

describe("confidence", () => {
  it("is high only with multiple photographic sources, a reading, no contrary evidence, no open alternative", () => {
    expect(computeConfidence({ evidence, causation, verification: { claims: [] }, packet: packet() }).grade).toBe("high");
  });
  it("is capped at medium by a single photo, no readings, an open alternative, or unconfirmed links", () => {
    const one = { ...evidence, observations: [{ id: "OBS-001", statement: "x", source_ids: ["PHOTO-1"] }] };
    expect(computeConfidence({ evidence: one, causation, verification: null, packet: packet() }).grade).toBe("medium");
    expect(computeConfidence({ evidence: { ...evidence, measurements: [] }, causation, verification: null, packet: packet() }).grade).toBe("medium");
    const alt = { ...causation, candidate_causes: [...causation.candidate_causes, { cause: "leak", supporting_observations: [], contrary_observations: [], confidence: "medium" }] };
    const c = computeConfidence({ evidence, causation: alt, verification: null, packet: packet() });
    expect(c.grade).toBe("medium");
    expect(c.reasons.join(" ")).toMatch(/alternative cause/);
    expect(computeConfidence({ evidence, causation, verification: null, packet: packet({ unconfirmedLinks: ["PHOTO-2"] }) }).grade).toBe("medium");
  });
  it("is low when evidence is incomplete or the verifier found an unsupported factual claim", () => {
    expect(computeConfidence({ evidence, causation, verification: null, packet: packet({ complete: false }) }).grade).toBe("low");
    expect(computeConfidence({ evidence, causation, verification: { claims: [{ type: "observation", support: "unsupported" }] }, packet: packet() }).grade).toBe("low");
  });
});

describe("gate", () => {
  const base = { packet: packet(), evidence, causation, analysis: { comparison: { agreement: "agree" }, remedial: { scope: "localised" }, price_items: [] }, legal: { refs: [], rejected: [] }, pricing: { unpriced: true, problems: [], flags: ["unpriced"], lines: [] }, verification: { claims: [] }, idProblems: [], confidence: { grade: "medium" } };
  it("is review_ready with only warnings", () => {
    const g = decideGate(base);
    expect(g.status).toBe("review_ready");
    expect(g.flags).toContain("unpriced");
    expect(g.blockingFlags).toEqual([]);
  });
  it("blocks on an unsupported material claim but not on an unsupported opinion", () => {
    expect(decideGate({ ...base, verification: { claims: [{ type: "extent", support: "unsupported", claim: "the whole ceiling" }] } }).status).toBe("blocked");
    expect(decideGate({ ...base, verification: { claims: [{ type: "legal", support: "unsupported", claim: "s.11" }] } }).status).toBe("review_ready");
  });
  it("blocks on a rejected legal id, an unknown price row, an id problem, or a price arithmetic mismatch", () => {
    expect(decideGate({ ...base, legal: { refs: [], rejected: [{ id: "LEGAL-X" }] } }).status).toBe("blocked");
    expect(decideGate({ ...base, pricing: { ...base.pricing, problems: [{ row_id: "PB-X", problem: "unknown_row", detail: "no" }] } }).status).toBe("blocked");
    expect(decideGate({ ...base, idProblems: ["draft cites exhibit 9"] }).status).toBe("blocked");
    expect(decideGate({ ...base, pricing: { unpriced: false, low: 999, high: 1000, lines: [{ priced: true, low: 100, high: 200 }], problems: [], flags: [] } }).status).toBe("blocked");
  });
  it("is incomplete_evidence when the packet is incomplete and nothing blocks", () => {
    const g = decideGate({ ...base, packet: packet({ complete: false, incomplete: [{ source_id: "MEMO-1", reason: "failed" }] }) });
    expect(g.status).toBe("incomplete_evidence");
    expect(g.reasons).toEqual(["MEMO-1: failed"]);
    expect(g.flags).toContain("incomplete_evidence");
  });
  it("raises disagreement, scope and low-confidence warnings", () => {
    const g = decideGate({ ...base, analysis: { comparison: { agreement: "disagree" }, remedial: { scope: "investigation_first" } }, confidence: { grade: "low" } });
    expect(g.flags).toEqual(expect.arrayContaining(["disagreement", "scope_uncertain", "low_confidence"]));
    expect(g.status).toBe("review_ready");
  });
});

describe("validateIds", () => {
  it("flags ids the model invented and exhibits not linked to the issue", () => {
    const p = packet();
    const bad = { observations: [{ id: "OBS-001", statement: "x", source_ids: ["PHOTO-9"] }], statements: [], measurements: [] };
    expect(validateIds(p, bad, null, { photo_refs: [1, 7] })).toEqual(["OBS-001 cites unknown source PHOTO-9", "draft cites exhibit 7, which is not linked to this issue"]);
    expect(validateIds(p, evidence, { comparison: { evidence_supporting_surveyor: ["OBS-001"], evidence_contradicting_surveyor: [] }, extent: { source_ids: ["PHOTO-1"] }, price_items: [] }, { photo_refs: [1] })).toEqual([]);
  });
});
