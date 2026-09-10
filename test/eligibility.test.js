// Scenario 1 & 2 of the spec: AI-generated text never makes an issue
// eligible on its own; a surveyor adopting an AI note does — and the
// adoption keeps both versions. Also: notes of unknown (pre-2.0) origin are
// not assumed human.
import { describe, expect, it } from "vitest";
import { issueEligibility } from "../shared/eligibility.js";
import { newIssue, linkEvidence, suggestAiNote, adoptAiNote, typeNote, migrateRoom, confirmIssue } from "../src/evidence.js";

const room = (over = {}) => ({ id: "room_a1b2c3", name: "Bathroom", photoIds: ["p1", "p2"], memos: [], issues: [], readings: [], modelVersion: 2, ...over });
const photosOnly = (r, issue) => linkEvidence(linkEvidence({ ...r, issues: [issue] }, issue.id, { id: "p1", kind: "photo", source: "capture_session" }), issue.id, { id: "p2", kind: "photo", source: "capture_session" });

describe("eligibility", () => {
  it("S1: an AI room note on a photos-only, unconfirmed issue does not qualify", () => {
    const issue = { ...newIssue("Ceiling mould", { createdBy: "ai", source: "ai_suggested", confirmed: false }) };
    let r = photosOnly(room(), issue);
    r = suggestAiNote(r, "Black mould to the ceiling above the shower.", "mock");
    expect(r.aiNote.adopted).toBe(false);
    expect(r.note).toBeUndefined();            // never written into the note
    const el = issueEligibility(r.issues[0], r, {});
    expect(el.eligible).toBe(false);
    expect(el.sources).toEqual([]);
  });

  it("S1b: even if an AI note were forced into the note field, ai_generated provenance keeps it out", () => {
    const issue = newIssue("Ceiling mould", { createdBy: "ai", source: "ai_suggested", confirmed: false });
    const r = { ...photosOnly(room(), issue), note: "Black mould to the ceiling.", noteSource: "ai_generated" };
    const el = issueEligibility(r.issues[0], r, {});
    expect(el.eligible).toBe(false);
    expect(el.missing.join(" ")).toMatch(/AI-generated/);
  });

  it("S2: adopting the AI note keeps the original, records who and when, and makes the issue eligible", () => {
    const issue = newIssue("Ceiling mould");
    let r = suggestAiNote(photosOnly(room(), issue), "Black mould to the ceiling above the shower.", "mock");
    r = adoptAiNote(r, "user-1");
    expect(r.noteSource).toBe("human_adopted_ai");
    expect(r.note).toBe("Black mould to the ceiling above the shower.");
    expect(r.aiNote.text).toBe("Black mould to the ceiling above the shower.");
    expect(r.aiNote.adopted).toBe(true);
    expect(r.aiNote.adoptedBy).toBe("user-1");
    expect(r.aiNote.adoptedAt).toBeTruthy();
    const el = issueEligibility(r.issues[0], r, {});
    expect(el.eligible).toBe(true);
    expect(el.sources).toContain("room_note");
  });

  it("S2b: editing an adopted note makes it human-typed; the AI original survives in aiNote", () => {
    let r = adoptAiNote(suggestAiNote(room(), "Mould to ceiling.", "mock"), "u");
    r = typeNote(r, "Mould to ceiling, extractor not working.");
    expect(r.noteSource).toBe("human_typed");
    expect(r.aiNote.text).toBe("Mould to ceiling.");
    expect(r.aiNote.adoptedText).toBe("Mould to ceiling.");
  });

  it("pre-2.0 notes are legacy_unknown and do not qualify until the issue is confirmed", () => {
    const legacy = migrateRoom({ id: "room_x1y2z3", name: "Kitchen", photoIds: ["p1"], note: "Damp to wall" });
    expect(legacy.noteSource).toBe("legacy_unknown");
    const issue = newIssue("Damp", { createdBy: "ai", source: "ai_suggested", confirmed: false });
    let r = linkEvidence({ ...legacy, issues: [issue] }, issue.id, { id: "p1", kind: "photo", source: "ai_suggested" });
    expect(issueEligibility(r.issues[0], r, {}).eligible).toBe(false);
    r = confirmIssue(r, issue.id);
    const el = issueEligibility(r.issues[0], r, {});
    expect(el.eligible).toBe(true);
    expect(el.sources).toContain("confirmed_issue");
    expect(r.issues[0].evidence[0].source).toBe("human_confirmed_ai");
  });

  it("a surveyor-created issue with photos and a typed description is eligible; AI description is not", () => {
    const issue = newIssue("Cracked tiles");
    const r = photosOnly(room(), issue);
    expect(issueEligibility({ ...r.issues[0], description: "Three cracked tiles above the bath", descriptionSource: "human_typed" }, r, {}).sources).toContain("issue_description");
    expect(issueEligibility({ ...r.issues[0], confirmedBySurveyor: false, description: "Cracked tiles", descriptionSource: "ai_generated" }, r, {}).eligible).toBe(false);
  });

  it("a voice memo alone qualifies (the transcript may still fail — that is the pipeline's incomplete state)", () => {
    const issue = newIssue("Leak", { confirmed: false });
    const r = linkEvidence({ ...room({ memos: [{ id: "m1" }] }), issues: [issue] }, issue.id, { id: "m1", kind: "memo", source: "capture_session" });
    expect(issueEligibility(r.issues[0], r, {}).sources).toEqual(["voice_memo"]);
  });
});
