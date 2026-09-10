// Scenarios 10, 11, 12, 15 and the migration: editing is not approval;
// approval is blocked by the gate and by stale evidence; approved findings
// whose evidence moves go back to review with their approved revision kept;
// only approved findings are reportable; legacy "edited" findings stay
// reportable with a record of why.
import { describe, expect, it } from "vitest";
import { emptyFindings, mergeRun, transition, reconcile, approvedByRoom, migrateFindings, liveItems, effective, coverage } from "../src/findings.js";
import { isReportable } from "../shared/findingRules.js";
import { addIssue, linkEvidence, issueFingerprint, migrateRoom } from "../src/evidence.js";

function setup(gate = { status: "review_ready", reasons: [], flags: [] }) {
  let room = migrateRoom({ id: "room_f1", name: "Bathroom", photoIds: ["p1", "p2"], memos: [] });
  const a = addIssue(room, "Ceiling mould"); room = a.room;
  room = linkEvidence(room, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
  const photos = { p1: { no: 1, caption: "" } };
  const snapshot = issueFingerprint(room.issues[0], room, photos, {});
  const res = {
    run: { id: "run-1", at: "2026-09-09T10:00:00Z", snapshot, model: "mock", stageHashes: {}, stages: {} },
    finding: { id: "f-1", title: "Damp and mould to bathroom", defect: "Mould was observed.", remedial: { works: "Treat", scope: "localised", conditions: [] }, cost: { low: 100, high: 200, unpriced: false, basis: "x", price_book_refs: ["MOULD-WALL"], lines: [] }, legislation: [], assessment: { likely_cause: "condensation", agreement: "agree" }, review_flags: [], gate, confidence: "medium" },
  };
  const state = mergeRun(emptyFindings(), { issue: room.issues[0], room }, res);
  return { room, photos, state, snapshot, issue: room.issues[0] };
}

describe("finding state machine", () => {
  it("S10: editing produces `edited`, never `approved`; approval is a separate explicit step", () => {
    const { state, snapshot } = setup();
    const e = transition(state, "f-1", "edited", { reviewed: { defect: "My wording", at: 1 }, currentFingerprint: snapshot });
    expect(e.error).toBeNull();
    const f = e.state.items[0];
    expect(f.status).toBe("edited");
    expect(isReportable(f)).toBe(false);
    expect(f.defect).toBe("Mould was observed.");       // AI original kept
    expect(effective(f).defect).toBe("My wording");      // surveyor's wording overlays
    const a = transition(e.state, "f-1", "approved", { currentFingerprint: snapshot, by: "u1" });
    expect(a.error).toBeNull();
    expect(a.state.items[0].status).toBe("approved");
    expect(a.state.items[0].approval).toMatchObject({ by: "u1", fingerprint: snapshot });
  });

  it("S9: a blocked gate cannot be approved", () => {
    const { state, snapshot } = setup({ status: "blocked", reasons: ["unsupported measurement: \"4.5%\""], flags: ["unsupported_claim"] });
    const a = transition(state, "f-1", "approved", { currentFingerprint: snapshot });
    expect(a.error).toMatch(/unsupported measurement/);
    expect(a.state.items[0].status).toBe("draft");
  });

  it("S5: incomplete evidence cannot be approved as complete", () => {
    const { state, snapshot } = setup({ status: "incomplete_evidence", reasons: ["MEMO-1: voice note could not be transcribed"], flags: ["incomplete_evidence"] });
    expect(transition(state, "f-1", "approved", { currentFingerprint: snapshot }).error).toMatch(/MEMO-1/);
  });

  it("S15: approval is refused when the evidence fingerprint no longer matches the draft's snapshot", () => {
    const { state } = setup();
    const a = transition(state, "f-1", "approved", { currentFingerprint: "different" });
    expect(a.error).toMatch(/evidence changed/);
  });

  it("S11: evidence changing after approval moves the finding to review_required and preserves the approved revision", () => {
    const { room, photos, state, snapshot } = setup();
    const approved = transition(state, "f-1", "approved", { currentFingerprint: snapshot, by: "u1" }).state;
    // a second photograph is linked to the issue
    const room2 = linkEvidence(room, room.issues[0].id, { id: "p2", kind: "photo", source: "human_created" });
    const { state: next, changed } = reconcile(approved, { rooms: [room2], photoCache: { ...photos, p2: { no: 2 } }, transcripts: {} });
    expect(changed.length).toBe(1);
    const f = next.items[0];
    expect(f.status).toBe("review_required");
    expect(f.stale).toBe(true);
    expect(f.review_flags).toContain("stale_analysis");
    expect(f.revisions.length).toBe(1);
    expect(f.revisions[0].approval.by).toBe("u1");
    expect(f.approval).toBeNull();
    expect(isReportable(f)).toBe(false);
    // approval stays refused until regenerated
    expect(transition(next, "f-1", "approved", { currentFingerprint: issueFingerprint(room2.issues[0], room2, { ...photos, p2: { no: 2 } }, {}) }).error).toMatch(/evidence changed/);
    // reconcile is idempotent
    expect(reconcile(next, { rooms: [room2], photoCache: { ...photos, p2: { no: 2 } }, transcripts: {} }).changed).toEqual([]);
  });

  it("reference pack changes under a cited row also invalidate", () => {
    const { room, photos, state, snapshot } = setup();
    const withRef = { ...state, runs: { ...state.runs, [room.issues[0].id]: { ...state.runs[room.issues[0].id], reference: { cited: { priceRows: { "MOULD-WALL": "oldhash" }, legal: {}, hazard: {} } } } } };
    const approved = transition(withRef, "f-1", "approved", { currentFingerprint: snapshot }).state;
    const { state: next } = reconcile(approved, { rooms: [room], photoCache: photos, transcripts: {}, refState: { priceRows: { "MOULD-WALL": "newhash" }, legalEntries: {}, hazards: {} } });
    expect(next.items[0].status).toBe("review_required");
    expect(next.items[0].staleReasons[0]).toMatch(/price book row MOULD-WALL changed/);
  });

  it("S12: only approved findings reach the report — drafts, edited, rejected, superseded and mock never do", () => {
    const { room, state, snapshot } = setup();
    const rooms = [room];
    expect(approvedByRoom(state, rooms)).toEqual([]);
    const edited = transition(state, "f-1", "edited", { reviewed: { defect: "x" }, currentFingerprint: snapshot }).state;
    expect(approvedByRoom(edited, rooms)).toEqual([]);
    const approved = transition(edited, "f-1", "approved", { currentFingerprint: snapshot }).state;
    expect(approvedByRoom(approved, rooms)[0].findings[0].defect).toBe("x");
    const rejected = transition(approved, "f-1", "rejected", { currentFingerprint: snapshot }).state;
    expect(approvedByRoom(rejected, rooms)).toEqual([]);
    expect(rejected.items[0].revisions.length).toBe(1);
    // a regenerated draft supersedes the old live one
    const res2 = { run: { id: "run-2", at: "2026-09-09T11:00:00Z", snapshot }, finding: { id: "f-2", title: "t", defect: "d", remedial: { works: "", scope: "localised", conditions: [] }, cost: { unpriced: true }, legislation: [], assessment: {}, review_flags: [], gate: { status: "review_ready", reasons: [], flags: [] } } };
    const back = transition(rejected, "f-1", "draft", { currentFingerprint: snapshot }).state;
    const two = mergeRun(back, { issue: room.issues[0], room }, res2);
    expect(two.items.find((f) => f.id === "f-1").status).toBe("superseded");
    expect(liveItems(two).map((f) => f.id)).toEqual(["f-2"]);
    expect(isReportable({ status: "approved", mock: true })).toBe(false);
  });

  it("cannot jump from superseded to anything; cannot approve a rejected finding directly", () => {
    const { state, snapshot } = setup();
    const rej = transition(state, "f-1", "rejected", { currentFingerprint: snapshot }).state;
    expect(transition(rej, "f-1", "approved", { currentFingerprint: snapshot }).error).toMatch(/cannot become/);
  });
});

describe("migration of pre-2.0 findings", () => {
  it("edited → approved with a legacy approval record; drafts stay drafts and are marked legacy", () => {
    const v1 = { runs: { room_f1: { id: "r", at: 1, model: "claude" } }, items: [
      { id: "a", roomId: "room_f1", roomName: "Bathroom", status: "edited", reviewed: { defect: "mine" }, defect: "ai", remedial: { works: "" }, cost: { unpriced: true }, legislation: [], assessment: {} },
      { id: "b", roomId: "room_f1", roomName: "Bathroom", status: "draft", defect: "ai2", remedial: { works: "" }, cost: { unpriced: true }, legislation: [], assessment: {} },
    ] };
    const v2 = migrateFindings(v1);
    expect(v2.version).toBe(2);
    expect(v2.items[0].status).toBe("approved");
    expect(v2.items[0].approval.legacy).toBe(true);
    expect(v2.items[0].issueId).toBe("legacy_room_f1");
    expect(v2.items[1].status).toBe("draft");
    expect(v2.items[1].legacy).toBe(true);
    expect(approvedByRoom(v2, [{ id: "room_f1", name: "Bathroom" }])[0].findings[0].defect).toBe("mine");
    expect(migrateFindings(v2)).toBe(v2);
  });
});

describe("coverage", () => {
  it("reports every issue, loose evidence and failed transcripts — nothing skipped silently", () => {
    let room = migrateRoom({ id: "room_c1", name: "Kitchen", photoIds: ["p1", "p2", "p3"], memos: [{ id: "m1" }] });
    const a = addIssue(room, "Damp"); room = a.room;
    room = linkEvidence(room, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
    room = linkEvidence(room, a.issue.id, { id: "m1", kind: "memo", source: "capture_session" });
    const cov = coverage([room], emptyFindings(), { m1: { status: "failed", text: "" } });
    expect(cov[0].issues[0].failedMemos).toEqual(["m1"]);
    expect(cov[0].loose.photoIds).toEqual(["p2", "p3"]);
    expect(cov[0].legacy).not.toBeNull();
  });
});
