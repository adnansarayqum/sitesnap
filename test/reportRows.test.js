// reportRows() turns approved findings into the one-row-per-room shape
// Shah's MLA/TLB Scott Schedule expects. Exercised directly against
// findings.js's real state machine (mergeRun/transition) rather than a
// hand-built shape, so it stays honest to what an approved finding
// actually looks like.
import { describe, expect, it } from "vitest";
import { emptyFindings, mergeRun, transition } from "../src/findings.js";
import { addIssue, linkEvidence, issueFingerprint, migrateRoom } from "../src/evidence.js";
import { reportRows } from "../src/export/reportRows.js";

function approvedRoom({ id, name, issueOfConcern, findingProps }) {
  let room = migrateRoom({ id, name, photoIds: ["p1"], memos: [] });
  room.issueOfConcern = issueOfConcern;
  const a = addIssue(room, "Defect"); room = a.room;
  room = linkEvidence(room, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
  const photos = { p1: { no: 1, caption: "" } };
  const snapshot = issueFingerprint(room.issues[0], room, photos, {});
  const gate = { status: "review_ready", reasons: [], flags: [] };
  const res = {
    run: { id: `run-${id}`, at: "2026-09-09T10:00:00Z", snapshot, model: "mock", stageHashes: {}, stages: {} },
    finding: { id: `f-${id}`, title: "A defect", cost: { low: 100, high: 100, unpriced: false, basis: "x", price_book_refs: [], lines: [] }, review_flags: [], gate, confidence: "medium", remedial: { works: "Renew it.", scope: "localised", conditions: [] }, ...findingProps },
  };
  let state = mergeRun(emptyFindings(), { issue: room.issues[0], room }, res);
  const t = transition(state, `f-${id}`, "approved", { currentFingerprint: snapshot, by: "u1" });
  expect(t.error).toBeNull();
  return { room, state: t.state };
}

describe("reportRows", () => {
  it("one row per room, only for rooms with an approved finding", () => {
    const kitchen = approvedRoom({ id: "r1", name: "Kitchen", issueOfConcern: "There is a leak.", findingProps: { defect: "A leak was observed.", cause_text: "Attributable to a failed joint.", legislation: ["S11 LTA"] } });
    const bathroomOnlyDraft = migrateRoom({ id: "r2", name: "Bathroom", photoIds: [], memos: [] }); // no findings at all
    const inspection = { findings: kitchen.state };
    const { rows, warnings } = reportRows(inspection, [kitchen.room, bathroomOnlyDraft]);
    expect(rows).toHaveLength(1);
    expect(rows[0].room).toBe("Kitchen");
    expect(rows[0].issueOfConcern).toBe("There is a leak.");
    expect(rows[0].siteFindings).toContain("A leak was observed.");
    expect(rows[0].causation).toContain("failed joint");
    expect(rows[0].remedialWorks).toContain("Renew it.");
    expect(rows[0].cost).toBe(100);
    expect(rows[0].breach).toBe("S11 LTA");
    expect(warnings).toEqual([]);
  });

  it("sums cost across multiple approved findings in the same room, skipping unpriced ones", () => {
    let room = migrateRoom({ id: "r1", name: "Kitchen", photoIds: ["p1", "p2"], memos: [] });
    room.issueOfConcern = "Two issues.";
    const a = addIssue(room, "Leak"); room = a.room;
    room = linkEvidence(room, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
    const b = addIssue(room, "Mould"); room = b.room;
    room = linkEvidence(room, b.issue.id, { id: "p2", kind: "photo", source: "capture_session" });
    const photos = { p1: { no: 1, caption: "" }, p2: { no: 2, caption: "" } };
    const gate = { status: "review_ready", reasons: [], flags: [] };
    let state = emptyFindings();
    state = mergeRun(state, { issue: a.issue, room }, { run: { id: "run-a", at: "t", snapshot: issueFingerprint(a.issue, room, photos, {}), model: "m", stageHashes: {}, stages: {} }, finding: { id: "f-a", title: "Leak", defect: "d1", remedial: { works: "w1", scope: "localised", conditions: [] }, cost: { low: 120, high: 120, unpriced: false, basis: "x", price_book_refs: [], lines: [] }, legislation: ["S11 LTA"], review_flags: [], gate, confidence: "medium" } });
    state = transition(state, "f-a", "approved", { currentFingerprint: issueFingerprint(a.issue, room, photos, {}), by: "u1" }).state;
    state = mergeRun(state, { issue: b.issue, room }, { run: { id: "run-b", at: "t", snapshot: issueFingerprint(b.issue, room, photos, {}), model: "m", stageHashes: {}, stages: {} }, finding: { id: "f-b", title: "Mould", defect: "d2", remedial: { works: "w2", scope: "localised", conditions: [] }, cost: { low: 0, high: 0, unpriced: true, basis: "x", price_book_refs: [], lines: [] }, legislation: ["S9A LTA"], hhsrs_hazard: "Cat 2 Risk Hazard 11", review_flags: [], gate, confidence: "medium" } });
    state = transition(state, "f-b", "approved", { currentFingerprint: issueFingerprint(b.issue, room, photos, {}), by: "u1" }).state;

    const { rows, warnings } = reportRows({ findings: state }, [room]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toBe(120); // the unpriced finding contributes 0, not NaN or a crash
    expect(rows[0].siteFindings).toBe("d1 d2");
    expect(rows[0].breach).toBe("S9A S11 LTA - Cat 2, Risk Hazard 11"); // canonical order regardless of which finding was approved first
    expect(warnings.some((w) => w.includes("unpriced"))).toBe(true);
  });

  it("flags a room with no Issue of Concern captured", () => {
    const { room, state } = approvedRoom({ id: "r1", name: "Kitchen", issueOfConcern: "", findingProps: { defect: "d", legislation: [] } });
    const { warnings } = reportRows({ findings: state }, [room]);
    expect(warnings.some((w) => w.includes("Issue of Concern"))).toBe(true);
  });

  it("flags a trade whose small line items sum below a realistic visit, once across the whole case, and leaves the per-room costs untouched", () => {
    let kitchen = migrateRoom({ id: "r1", name: "Kitchen", photoIds: ["p1"], memos: [] });
    kitchen.issueOfConcern = "Cracking in two spots.";
    const a = addIssue(kitchen, "Ceiling crack"); kitchen = a.room;
    kitchen = linkEvidence(kitchen, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
    let bedroom = migrateRoom({ id: "r2", name: "Bedroom", photoIds: ["p2"], memos: [] });
    bedroom.issueOfConcern = "Mould on the wall.";
    const b = addIssue(bedroom, "Mould"); bedroom = b.room;
    bedroom = linkEvidence(bedroom, b.issue.id, { id: "p2", kind: "photo", source: "capture_session" });
    const photos = { p1: {}, p2: {} };
    const gate = { status: "review_ready", reasons: [], flags: [] };
    let state = emptyFindings();
    const snapA = issueFingerprint(a.issue, kitchen, photos, {});
    state = mergeRun(state, { issue: a.issue, room: kitchen }, { run: { id: "run-a", at: "t", snapshot: snapA, model: "m", stageHashes: {}, stages: {} }, finding: { id: "f-a", title: "x", defect: "d1", remedial: { works: "w1", scope: "localised", conditions: [] }, cost: { low: 24, high: 40, unpriced: false, basis: "x", price_book_refs: ["CEIL-CRACK-LOCAL"], lines: [{ row_id: "CEIL-CRACK-LOCAL", trade: "plasterer_decorator", priced: true, low: 24, high: 40 }] }, legislation: ["S11 LTA"], review_flags: [], gate, confidence: "medium" } });
    state = transition(state, "f-a", "approved", { currentFingerprint: snapA, by: "u1" }).state;
    const snapB = issueFingerprint(b.issue, bedroom, photos, {});
    state = mergeRun(state, { issue: b.issue, room: bedroom }, { run: { id: "run-b", at: "t", snapshot: snapB, model: "m", stageHashes: {}, stages: {} }, finding: { id: "f-b", title: "x", defect: "d2", remedial: { works: "w2", scope: "localised", conditions: [] }, cost: { low: 24, high: 40, unpriced: false, basis: "x", price_book_refs: ["MOULD-WALL"], lines: [{ row_id: "MOULD-WALL", trade: "plasterer_decorator", priced: true, low: 24, high: 40 }] }, legislation: ["S9A LTA"], review_flags: [], gate, confidence: "medium" } });
    state = transition(state, "f-b", "approved", { currentFingerprint: snapB, by: "u1" }).state;

    const trades = { plasterer_decorator: { label: "Plasterer/decorator", minimum: { low: 250, high: 300 } } };
    const noTrades = reportRows({ findings: state }, [kitchen, bedroom]);
    expect(noTrades.warnings.some((w) => w.startsWith("Pricing:"))).toBe(false); // no trades table — no crash, no false warning

    const { rows, warnings } = reportRows({ findings: state }, [kitchen, bedroom], trades);
    expect(rows.find((r) => r.room === "Kitchen").cost).toBe(24); // per-room audit trail is untouched
    expect(rows.find((r) => r.room === "Bedroom").cost).toBe(24);
    const w = warnings.find((x) => x.startsWith("Pricing:"));
    expect(w).toMatch(/£48/); // the naive sum across both rooms
    expect(w).toMatch(/£250–£300/);
  });

  it("combines multiple hazard numbers at the same category with 'and'", () => {
    let room = migrateRoom({ id: "r1", name: "Bathroom", photoIds: ["p1", "p2", "p3"], memos: [] });
    room.issueOfConcern = "x";
    const mk = (n) => { const r = addIssue(room, `Issue ${n}`); room = r.room; room = linkEvidence(room, r.issue.id, { id: `p${n}`, kind: "photo", source: "capture_session" }); return r.issue; };
    const issues = [mk(1), mk(2), mk(3)];
    const photos = { p1: {}, p2: {}, p3: {} };
    const gate = { status: "review_ready", reasons: [], flags: [] };
    let state = emptyFindings();
    const hazards = ["Cat 2 Risk Hazard 1", "Cat 2 Risk Hazard 8", "Cat 2 Risk Hazard 11"];
    issues.forEach((issue, i) => {
      const snap = issueFingerprint(issue, room, photos, {});
      state = mergeRun(state, { issue, room }, { run: { id: `run-${i}`, at: "t", snapshot: snap, model: "m", stageHashes: {}, stages: {} }, finding: { id: `f-${i}`, title: "x", defect: "d", remedial: { works: "w", scope: "localised", conditions: [] }, cost: { low: 10, high: 10, unpriced: false, basis: "x", price_book_refs: [], lines: [] }, legislation: ["S9A LTA"], hhsrs_hazard: hazards[i], review_flags: [], gate, confidence: "medium" } });
      state = transition(state, `f-${i}`, "approved", { currentFingerprint: snap, by: "u1" }).state;
    });
    const { rows } = reportRows({ findings: state }, [room]);
    expect(rows[0].breach).toBe("S9A LTA - Cat 2, Risk Hazards 1, 8 and 11");
  });
});
