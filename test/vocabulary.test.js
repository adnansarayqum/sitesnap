// The firm's controlled vocabulary (legal-register.md) has words it never
// uses in a report — "wetting" (the surveyor: "use saturated or other
// standard building surveying terms"), "dampness", "distortion", "moisture
// meter" (the firm writes "protimeter"), "repaired or renewed". Until now
// nothing checked drafted prose for them. The eval suite's
// no_banned_vocabulary invariant now does, for every pipeline case; this
// test proves the pattern bites and that the mock pipeline's own output is
// clean, so CI enforces it without a model call.
import { beforeAll, describe, expect, it } from "vitest";
import { BANNED_VOCABULARY, RULES } from "../server/evals/lib/assertions.mjs";

process.env.AI_MOCK = "1";
let runIssuePipeline;
beforeAll(async () => {
  ({ runIssuePipeline } = await import("../server/ai/pipeline.js"));
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const input = () => ({
  requestId: "22222222-2222-4222-8222-222222222222", snapshot: "snap-v",
  context: { roomName: "Bathroom", roomOrder: 2, roomCondition: "Poor", builtPre2000: null, inspectedAt: "2026-09-01T10:00:00Z", address: "12 Acacia Road", client: "Lewisham Homes" },
  issue: { id: "iss_v0c4bul4", title: "Ceiling mould", description: "Black mould above shower", descriptionSource: "human_typed", humanSuspectedCause: "", confirmedBySurveyor: true, createdBy: "surveyor",
    evidence: [{ id: "ph1", kind: "photo", source: "capture_session" }] },
  room: { name: "Bathroom", note: "Mould to ceiling, extractor not working, readings 4.5%", noteSource: "human_typed", hypothesis: "", condition: "Poor" },
  note: { text: "Mould to ceiling, extractor not working, readings 4.5%", source: "human_typed" },
  photos: [{ id: "ph1", no: 3, caption: "mould to ceiling", captionSource: "human", dataUrl: PNG, linkSource: "capture_session" }],
  memos: [], readings: [],
});

describe("controlled vocabulary", () => {
  it("the banned-word pattern catches each term the firm never uses, and nothing it does", () => {
    for (const bad of ["wetting", "Wetting", "wetted", "dampness", "distortion", "moisture meter", "repaired or renewed"]) {
      expect(BANNED_VOCABULARY.test(`Prolonged ${bad} was noted.`), bad).toBe(true);
    }
    for (const ok of ["saturated", "saturation", "damp", "protimeter readings of 18% WME", "renewed", "wet through"]) {
      expect(BANNED_VOCABULARY.test(`The plaster was ${ok}.`), ok).toBe(false);
    }
  });

  it("the eval invariant fails a finding that uses a banned word, whichever prose field carries it", () => {
    const rule = RULES.no_banned_vocabulary;
    expect(rule({ finding: { defect: "Prolonged wetting of the plaster was observed." } }).pass).toBe(false);
    expect(rule({ finding: { cause_text: "Attributable to dampness." } }).pass).toBe(false);
    expect(rule({ finding: { remedial: { works: "The fan should be repaired or renewed." } } }).pass).toBe(false);
    expect(rule({ finding: { defect: "Saturated plaster was observed.", cause_text: "Attributable to water ingress.", remedial: { works: "Renew the fan." } } }).pass).toBe(true);
  });

  it("the mock pipeline's own drafted prose is clean", async () => {
    const { finding } = await runIssuePipeline(input());
    const prose = [finding.defect, finding.cause_text, finding.remedial && finding.remedial.works].filter(Boolean).join("\n");
    expect(prose.length).toBeGreaterThan(0);
    expect(prose).not.toMatch(BANNED_VOCABULARY);
    expect(RULES.no_banned_vocabulary({ finding }).pass).toBe(true);
  });
});
