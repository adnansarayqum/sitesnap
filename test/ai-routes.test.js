// The HTTP surface in local mode (no database): eligibility is enforced on
// the server, pricing is deterministic and server-side, bad ids are refused,
// and the state-machine rules module agrees with itself.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import express from "express";

process.env.AI_MOCK = "1";
let server, base;
beforeAll(async () => {
  const { mountAi } = await import("../server/ai-routes.js");
  const app = express();
  mountAi(app);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.code || "error", message: err.message }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const post = (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("/api/ai", () => {
  it("config exposes reference versions and per-entry hashes for stale detection", async () => {
    const j = await (await fetch(base + "/api/ai/config")).json();
    expect(j.enabled).toBe(true);
    expect(j.pipelineVersion).toMatch(/^2\./);
    expect(j.reference.priceRows["MOULD-WALL"]).toMatch(/^[0-9a-f]{12}$/);
    expect(j.reference.legalEntries["LEGAL-S11-LTA"]).toBeTruthy();
  });

  it("draft: refuses an ineligible issue with 422 and says why", async () => {
    const r = await post("/api/ai/cases/insp_abc123/rooms/room_abc123/issues/iss_abc123/draft", { issue: { title: "x", evidence: [{ id: "p1", kind: "photo", source: "ai_suggested" }] }, room: { name: "Kitchen", note: "AI text", noteSource: "ai_generated" }, photos: [{ id: "p1", dataUrl: PNG, no: 1 }] });
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.error).toBe("not_eligible");
    expect(j.eligibility.eligible).toBe(false);
  });

  it("draft: a confirmed issue with a human note returns a finding and a full run record", async () => {
    const r = await post("/api/ai/cases/insp_abc123/rooms/room_abc123/issues/iss_abc123/draft", {
      requestId: "55555555-5555-4555-8555-555555555555", snapshot: "fp1",
      issue: { title: "Ceiling mould", description: "Mould above shower", descriptionSource: "human_typed", confirmedBySurveyor: true, evidence: [{ id: "p1", kind: "photo", source: "capture_session" }] },
      room: { name: "Bathroom", note: "", condition: "Poor" }, photos: [{ id: "p1", dataUrl: PNG, no: 1, caption: "mould" }], memos: [],
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.finding.status).toBe("draft");
    expect(j.finding.evidenceFingerprint).toBe("fp1");
    expect(j.finding.mock).toBe(true);
    expect(j.run.id).toBe("55555555-5555-4555-8555-555555555555");
    expect(j.run.stages.verification.claims.length).toBeGreaterThan(0);
  });

  it("draft: rejects malformed ids", async () => {
    expect((await post("/api/ai/cases/bad/rooms/room_abc123/issues/iss_abc123/draft", {})).status).toBe(400);
    expect((await post("/api/ai/cases/insp_abc123/rooms/room_abc123/issues/nope/draft", {})).status).toBe(400);
  });

  it("price: server-side arithmetic; unknown rows never price; surveyor quantities do", async () => {
    const bad = await (await post("/api/ai/price", { items: [{ price_book_row_id: "NOPE", quantity: 1, quantity_basis: "assumed" }] })).json();
    expect(bad.unpriced).toBe(true);
    const ok = await (await post("/api/ai/price", { items: [{ price_book_row_id: "REPOINT-LOCAL", quantity: 0, quantity_basis: "unknown" }], overrides: { "REPOINT-LOCAL": 4 } })).json();
    expect(ok.unpriced).toBe(false);
    expect(ok.lines[0].qtySource).toBe("surveyor");
    expect(ok.low).toBe(45 * 4);
  });

  it("cluster: suggestions come back marked ai_suggested with anything unplaced left uncertain", async () => {
    const r = await post("/api/ai/cases/insp_abc123/rooms/room_abc123/cluster", { room: { name: "Bathroom" }, photos: [{ id: "p1", dataUrl: PNG, no: 1 }, { id: "p2", dataUrl: PNG, no: 2 }, { id: "p3", dataUrl: PNG, no: 3 }], memos: [] });
    const j = await r.json();
    expect(j.issues.every((i) => i.source === "ai_suggested")).toBe(true);
    const placed = j.issues.flatMap((i) => i.photoIds);
    expect([...placed, ...j.uncertain.map((u) => u.id)].sort()).toEqual(["p1", "p2", "p3"]);
  });
});
