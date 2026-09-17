// pickSections (server/reference.js) is what stops a stage's prompt from
// silently losing a reference-pack section that got appended in the wrong
// place — exactly what happened to the drafting stage's "Controlled
// vocabulary" and "Category 1 hazard placement" sections, added to
// legal-register.md after the old positional cut point and never reaching
// the stage that writes the report's actual wording.
import { describe, expect, it } from "vitest";
import { pickSections, loadReference } from "../server/reference.js";
import { DRAFT_PHRASING_SECTIONS } from "../server/ai/stages.js";

const MD = `# Title

## First
Alpha content.

## Second
Beta content.
- a list item

### Not a top-level heading
This belongs to Second, not its own section.

## Third
Gamma content.
`;

describe("pickSections", () => {
  it("extracts named sections in the order requested, not the file's order", () => {
    const out = pickSections(MD, ["Third", "First"]);
    expect(out.indexOf("## Third")).toBeLessThan(out.indexOf("## First"));
    expect(out).toContain("Gamma content.");
    expect(out).toContain("Alpha content.");
    expect(out).not.toContain("Beta content.");
  });

  it("keeps a ### subsection as part of its parent ## section", () => {
    const out = pickSections(MD, ["Second"]);
    expect(out).toContain("Beta content.");
    expect(out).toContain("### Not a top-level heading");
    expect(out).toContain("This belongs to Second, not its own section.");
  });

  it("skips a heading that isn't in the file rather than throwing", () => {
    const out = pickSections(MD, ["Nonexistent", "First"]);
    expect(out).toContain("Alpha content.");
    expect(out).not.toMatch(/Nonexistent/);
  });

  it("returns an empty string when nothing named is found", () => {
    expect(pickSections(MD, ["Nope"])).toBe("");
    expect(pickSections(MD, [])).toBe("");
  });

  it("extracts the last section in the file correctly (no trailing heading to stop at)", () => {
    const out = pickSections(MD, ["Third"]);
    expect(out.trim()).toBe("## Third\nGamma content.");
  });
});

describe("draft stage's phrasing sections, against the real legal register", () => {
  it("actually finds Controlled vocabulary and Category 1 hazard placement in legal-register.md", () => {
    const ref = loadReference();
    // the pipeline's own list, not a copy — if draftStage() ever stops
    // asking for one of these, or legal-register.md ever renames one of
    // these headings, this catches it either way
    const out = pickSections(ref.legal.notes, DRAFT_PHRASING_SECTIONS);
    expect(out).toContain("## Controlled vocabulary");
    expect(out).toContain("protimeter readings");
    expect(out).toContain("## Category 1 hazard placement");
    expect(out).toContain("balance of probabilities");
    // and it must NOT pull in the citation-selection guidance — that's the analysis stage's job, not the drafting stage's
    expect(out).not.toContain("## Statutes and how the firm cites them");
    expect(out).not.toContain("## Rules for citing");
  });
});
