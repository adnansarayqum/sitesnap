// Known linked evidence must never silently disappear from the analysis. A
// photograph the issue links but the packet never received with an image is
// recorded as incomplete — the same convention as a failed transcription —
// and the finding cannot come out review_ready as if everything was analysed.
import { beforeAll, describe, expect, it } from "vitest";

process.env.AI_MOCK = "1";
let runIssuePipeline, buildPacket, validateIds;
beforeAll(async () => {
  ({ runIssuePipeline } = await import("../server/ai/pipeline.js"));
  ({ buildPacket } = await import("../server/ai/packet.js"));
  ({ validateIds } = await import("../server/ai/gate.js"));
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const photo = (id, no, over = {}) => ({ id, no, caption: `photo ${no}`, captionSource: "human", dataUrl: PNG, linkSource: "capture_session", ...over });
const input = ({ photos, evidence, ...over } = {}) => ({
  requestId: "22222222-2222-4222-8222-222222222222", snapshot: "snap",
  context: { roomName: "Bedroom 1", roomOrder: 4, roomCondition: "Fair", builtPre2000: false, inspectedAt: "2026-09-10T10:00:00Z" },
  issue: { id: "iss_missing01", title: "Mould to reveal", description: "Mould to the window reveal", descriptionSource: "human_typed", humanSuspectedCause: "", confirmedBySurveyor: true, createdBy: "surveyor",
    evidence: evidence || (photos || []).map((p) => ({ id: p.id, kind: "photo", source: "capture_session" })) },
  room: { name: "Bedroom 1", note: "Mould to reveal.", noteSource: "human_typed", hypothesis: "", condition: "Fair" },
  note: { text: "Mould to reveal.", source: "human_typed" },
  photos: photos || [], memos: [], readings: [],
  ...over,
});
const missingEntries = (packet) => packet.incomplete.filter((i) => /photograph/.test(i.reason));

describe("missing linked photographs are never silent", () => {
  it("1. linked photo available: packet complete, no missing-photo reason, normal gate", async () => {
    const p = buildPacket(input({ photos: [photo("ph1", 1)] }));
    expect(p.complete).toBe(true);
    expect(missingEntries(p)).toHaveLength(0);
    const { finding } = await runIssuePipeline(input({ photos: [photo("ph1", 1)] }));
    expect(finding.gate.status).toBe("review_ready");
    expect(finding.review_flags).not.toContain("incomplete_evidence");
  });

  it("2. linked photo missing (stub without an image): packet incomplete, recorded by exhibit, finding not review_ready", async () => {
    const stub = { id: "ph2", no: 2, caption: "extent across the head", captionSource: "human", linkSource: "capture_session" };
    const p = buildPacket(input({ photos: [stub] }));
    expect(p.complete).toBe(false);
    expect(missingEntries(p)).toEqual([{ source_id: "PHOTO-2", reason: expect.stringMatching(/could not be loaded/) }]);
    expect(p.sources["PHOTO-2"]).toMatchObject({ type: "photo", photoId: "ph2", missing: true, hash: null });
    expect(p.photos).toHaveLength(0);
    const { finding, run } = await runIssuePipeline(input({ photos: [stub] }));
    expect(finding.gate.status).toBe("incomplete_evidence");
    expect(finding.gate.reasons.join(" ")).toMatch(/PHOTO-2/);
    expect(finding.review_flags).toContain("incomplete_evidence");
    expect(finding.confidence).toBe("low");
    expect(run.evidence.complete).toBe(false);
    expect(run.evidence.incomplete.map((i) => i.source_id)).toContain("PHOTO-2");
  });

  it("2b. linked photo missing with no stub at all (only the evidence link): still reconciled and recorded", async () => {
    const inp = input({ photos: [photo("ph1", 1)], evidence: [{ id: "ph1", kind: "photo", source: "capture_session" }, { id: "ph9", kind: "photo", source: "capture_session" }] });
    const p = buildPacket(inp);
    expect(p.complete).toBe(false);
    expect(missingEntries(p).map((i) => i.source_id)).toEqual(["PHOTO-missing-1"]);
    expect(p.sources["PHOTO-missing-1"]).toMatchObject({ photoId: "ph9", missing: true });
    const { finding } = await runIssuePipeline(inp);
    expect(finding.gate.status).toBe("incomplete_evidence");
  });

  it("3. three linked photos, one missing: the two available are analysed, the third recorded, analysis incomplete", async () => {
    const photos = [photo("ph1", 1), { id: "ph2", no: 2, caption: "", captionSource: "human", linkSource: "capture_session" }, photo("ph3", 3)];
    const p = buildPacket(input({ photos }));
    expect(p.photos.map((x) => x.id)).toEqual(["PHOTO-1", "PHOTO-3"]);
    expect(missingEntries(p).map((i) => i.source_id)).toEqual(["PHOTO-2"]);
    const { finding, run } = await runIssuePipeline(input({ photos }));
    expect(run.evidence.photosAnalysed).toBe(2);
    expect(finding.evidence.observations.length).toBeGreaterThan(0);
    expect(finding.gate.status).toBe("incomplete_evidence");
    // the missing exhibit can never be cited as if it had been seen
    expect(validateIds(p, { observations: [{ id: "OBS-001", statement: "x", source_ids: ["PHOTO-2"] }], statements: [], measurements: [] }, null, { photo_refs: [2] })).toHaveLength(2);
    expect(validateIds(p, { observations: [{ id: "OBS-001", statement: "x", source_ids: ["PHOTO-1"] }], statements: [], measurements: [] }, null, { photo_refs: [1, 3] })).toHaveLength(0);
  });

  it("4. an unrelated room photo that is not linked to this issue has no effect", async () => {
    // the room has other photographs; only the issue's own links are reconciled
    const inp = input({ photos: [photo("ph1", 1)], evidence: [{ id: "ph1", kind: "photo", source: "capture_session" }, { id: "m1", kind: "memo", source: "capture_session" }] });
    const p = buildPacket(inp);
    expect(p.complete).toBe(true);
    expect(missingEntries(p)).toHaveLength(0);
  });

  it("5. batched photos: twelve linked and loaded count exactly once each, no false missing entries", async () => {
    const photos = Array.from({ length: 12 }, (_, i) => photo(`ph${i + 1}`, i + 1));
    const p = buildPacket(input({ photos }));
    expect(p.complete).toBe(true);
    expect(missingEntries(p)).toHaveLength(0);
    expect(Object.values(p.sources).filter((s) => s.type === "photo")).toHaveLength(12);
    const { finding, run } = await runIssuePipeline(input({ photos }));
    expect(run.evidence.evidenceBatches).toBe(2);
    expect(run.evidence.photosAnalysed).toBe(12);
    expect(finding.gate.status).toBe("review_ready");
    expect(finding.review_flags).not.toContain("incomplete_evidence");
  });

  it("an oversized or malformed data URL is a missing photograph, not a silently dropped one", () => {
    const p = buildPacket(input({ photos: [photo("ph1", 1, { dataUrl: "data:text/plain;base64,AAAA" })] }));
    expect(p.complete).toBe(false);
    expect(missingEntries(p).map((i) => i.source_id)).toEqual(["PHOTO-1"]);
  });
});
