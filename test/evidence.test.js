// Scenarios 3, 13, 14 and the fingerprint: two defects in one room stay
// separate; legacy evidence is represented without invented links; AI
// suggestions are unconfirmed until a person confirms; the evidence
// fingerprint moves when anything material moves.
import { describe, expect, it } from "vitest";
import {
  addIssue, linkEvidence, unlinkEvidence, issueFor, unassigned, legacyIssue, adoptLegacyIssue, addSuggestedIssues, confirmIssue, mergeIssues,
  issueFingerprint, correctTranscript, migrateTranscripts, transcriptFromServer, migrateRoom, addReading,
} from "../src/evidence.js";

const base = () => migrateRoom({ id: "room_b1", name: "Bathroom", photoIds: ["p1", "p2", "p3", "p4"], memos: [{ id: "m1", secs: 10 }, { id: "m2", secs: 8 }] });

describe("issues (defect clusters)", () => {
  it("S3: two issues in one room hold their own evidence; nothing bleeds between them", () => {
    let r = base();
    const a = addIssue(r, "Ceiling mould"); r = a.room;
    r = linkEvidence(r, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
    r = linkEvidence(r, a.issue.id, { id: "m1", kind: "memo", source: "capture_session" });
    const b = addIssue(r, "Damaged flooring"); r = b.room;
    r = linkEvidence(r, b.issue.id, { id: "p2", kind: "photo", source: "capture_session" });
    r = linkEvidence(r, b.issue.id, { id: "m2", kind: "memo", source: "capture_session" });
    expect(r.activeIssueId).toBe(b.issue.id);
    expect(issueFor(r, "p1").title).toBe("Ceiling mould");
    expect(issueFor(r, "m2").title).toBe("Damaged flooring");
    expect(r.issues[0].evidence.map((e) => e.id)).toEqual(["p1", "m1"]);
    expect(r.issues[1].evidence.map((e) => e.id)).toEqual(["p2", "m2"]);
    expect(unassigned(r).photoIds).toEqual(["p3", "p4"]);
    // moving a photo removes it from the first issue
    r = linkEvidence(r, b.issue.id, { id: "p1", kind: "photo", source: "human_created" });
    expect(r.issues[0].evidence.map((e) => e.id)).toEqual(["m1"]);
    expect(issueFor(r, "p1").id).toBe(b.issue.id);
    r = unlinkEvidence(r, "p1");
    expect(issueFor(r, "p1")).toBeNull();
  });

  it("S13: legacy evidence is one explicit unassigned bucket — unconfirmed, no photo↔memo pairs invented", () => {
    const r = base();
    const v = legacyIssue(r);
    expect(v.virtual).toBe(true);
    expect(v.confirmedBySurveyor).toBe(false);
    expect(v.associationSource).toBe("legacy_unassigned");
    expect(v.evidence.every((e) => e.source === "legacy_unassigned")).toBe(true);
    expect(v.evidence.map((e) => e.id)).toEqual(["p1", "p2", "p3", "p4", "m1", "m2"]);
    // the surveyor decides it is one issue: links become theirs, origin kept
    const { room: r2, issue } = adoptLegacyIssue(r, "Bathroom damp");
    expect(issue.confirmedBySurveyor).toBe(true);
    expect(issue.evidence.every((e) => e.source === "human_created" && e.legacyOrigin)).toBe(true);
    expect(legacyIssue(r2)).toBeNull();
  });

  it("S14: AI-suggested clusters land unconfirmed with every link marked, and confirming marks them human-confirmed", () => {
    const { room: r, created } = addSuggestedIssues(base(), [{ title: "Ceiling mould", photoIds: ["p1", "p2"], memoIds: ["m1"], confidence: "medium", rationale: "dark spotting" }]);
    const issue = r.issues.find((i) => i.id === created[0]);
    expect(issue.confirmedBySurveyor).toBe(false);
    expect(issue.createdBy).toBe("ai");
    expect(issue.evidence.every((e) => e.source === "ai_suggested")).toBe(true);
    const r2 = confirmIssue(r, issue.id);
    expect(r2.issues[0].confirmedBySurveyor).toBe(true);
    expect(r2.issues[0].evidence.every((e) => e.source === "human_confirmed_ai")).toBe(true);
  });

  it("merging keeps a record of the merge and empties the source issue", () => {
    let r = base();
    const a = addIssue(r, "Mould"); r = a.room; r = linkEvidence(r, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
    const b = addIssue(r, "Damp"); r = b.room; r = linkEvidence(r, b.issue.id, { id: "p2", kind: "photo", source: "capture_session" });
    r = mergeIssues(r, a.issue.id, b.issue.id, "u1");
    const into = r.issues.find((i) => i.id === b.issue.id);
    expect(into.evidence.map((e) => e.id).sort()).toEqual(["p1", "p2"]);
    expect(into.merges[0].from).toBe(a.issue.id);
    expect(r.issues.find((i) => i.id === a.issue.id).status).toBe("merged");
  });
});

describe("fingerprint and transcripts", () => {
  it("changes when a linked transcript is corrected, a photo moves, a reading is added — not when an AI caption changes", () => {
    let r = base();
    const a = addIssue(r, "Mould"); r = a.room;
    r = linkEvidence(r, a.issue.id, { id: "p1", kind: "photo", source: "capture_session" });
    r = linkEvidence(r, a.issue.id, { id: "m1", kind: "memo", source: "capture_session" });
    const photos = { p1: { no: 1, caption: "mould", captionAi: true } };
    let t = { m1: transcriptFromServer("m1", { text: "mould on the ceiling", provider: "openai", model: "whisper-1", audioHash: "abc", at: "2026-09-09T10:00:00Z" }) };
    const f0 = issueFingerprint(r.issues[0], r, photos, t);
    expect(issueFingerprint(r.issues[0], r, { p1: { ...photos.p1, caption: "different AI caption" } }, t)).toBe(f0);
    expect(issueFingerprint(r.issues[0], r, { p1: { no: 1, caption: "surveyor caption", captionAi: false } }, t)).not.toBe(f0);
    t = { m1: correctTranscript(t.m1, "mould on the ceiling above the shower", "u1") };
    expect(t.m1.status).toBe("corrected");
    expect(t.m1.original).toBe("mould on the ceiling");
    expect(t.m1.version).toBe(2);
    expect(issueFingerprint(r.issues[0], r, photos, t)).not.toBe(f0);
    const f1 = issueFingerprint(r.issues[0], r, photos, t);
    const r2 = addReading(r, { text: "moisture to wall", value: "4.5", unit: "%" }, a.issue.id).room;
    expect(issueFingerprint(r2.issues[0], r2, photos, t)).not.toBe(f1);
    const r3 = linkEvidence(r2, a.issue.id, { id: "p2", kind: "photo", source: "human_created" });
    expect(issueFingerprint(r3.issues[0], r3, photos, t)).not.toBe(issueFingerprint(r2.issues[0], r2, photos, t));
  });

  it("pre-2.0 transcripts migrate to records with an honest unknown provider", () => {
    const t = migrateTranscripts({ m1: "said on site", m2: "" });
    expect(t.m1).toMatchObject({ original: "said on site", text: "said on site", status: "complete", provider: "legacy_unknown", version: 1 });
    expect(t.m2.status).toBe("failed");
    expect(migrateTranscripts(t)).toEqual(t);
  });
});
