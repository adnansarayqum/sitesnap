// The firm's own rates: validated the same way on both ends, merged into the
// reference pack without touching the file pack, priced by the server like
// any other row, and offered on findings whose wording matches.
import { describe, expect, it } from "vitest";
import { normaliseRow, toPriceBookRow, suggestRows, newFirmRowId, isFirmRowId } from "../shared/pricebook.js";
import { mergeReference, cleanFirmRows } from "../server/pricebook.js";
import { loadReference, priceItems } from "../server/reference.js";
import { controlledLists } from "../server/ai/stages.js";
import { tidyCaption } from "../server/ai/captions.js";

const ref = loadReference(true);
const rate = (over = {}) => normaliseRow({ work: "Bathroom damp remediation", trade: "damp", low: 146, ...over }).row;

describe("rate validation (shared)", () => {
  it("needs a description and a figure; a single figure becomes an equal range", () => {
    expect(normaliseRow({ work: "ab", low: 100 }).ok).toBe(false);
    expect(normaliseRow({ work: "Mould treatment", low: "abc" }).ok).toBe(false);
    const r = normaliseRow({ work: "  Mould   treatment ", low: "120.4" });
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({ work: "Mould treatment", low: 120, high: 120, unit: "per item", active: true });
    expect(isFirmRowId(r.row.id)).toBe(true);
  });
  it("a reversed range is put the right way round; a client-supplied non-firm id is replaced", () => {
    const r = normaliseRow({ id: "ASB-SAMPLE", work: "Sampling", low: 300, high: 200 }).row;
    expect([r.low, r.high]).toEqual([200, 300]);
    expect(r.id).not.toBe("ASB-SAMPLE");
    expect(isFirmRowId(r.id)).toBe(true);
    expect(newFirmRowId()).toMatch(/^FIRM-[A-Z0-9]{8}$/);
  });
});

describe("merging the firm's rates into the reference pack", () => {
  it("adds rows the analysis stage can pick and the server can price, and changes the pack hash — without mutating the file pack", () => {
    const before = JSON.stringify(ref.priceBook.rows.map((r) => r.id));
    const merged = mergeReference(ref, [rate()]);
    const firm = merged.priceBook.rows.filter((r) => r.firm);
    expect(firm).toHaveLength(1);
    expect(merged.priceBook.byId[firm[0].id]).toBeTruthy();
    expect(merged.hashes.priceBook).not.toBe(ref.hashes.priceBook);
    expect(merged.versions.priceBook).toMatch(/\+1 firm$/);
    expect(JSON.stringify(ref.priceBook.rows.map((r) => r.id))).toBe(before);
    expect(ref.priceBook.byId[firm[0].id]).toBeUndefined();
    expect(controlledLists(merged).price_rows.some((r) => r.id === firm[0].id)).toBe(true);
    // no rows → the very same pack object
    expect(mergeReference(ref, [])).toBe(ref);
  });
  it("prices a firm rate deterministically: one item on an assumption, or the stated count", () => {
    const row = rate({ low: 146, high: 180 });
    const merged = mergeReference(ref, [row]);
    const assumed = priceItems(merged, [{ price_book_row_id: row.id, quantity: 0, quantity_basis: "unknown", quantity_evidence: [] }]);
    expect(assumed.unpriced).toBe(false);
    expect([assumed.low, assumed.high]).toEqual([146, 180]);
    expect(assumed.flags).toContain("price_assumption");
    const stated = priceItems(merged, [{ price_book_row_id: row.id, quantity: 2, quantity_basis: "stated", quantity_evidence: ["MEMO-1"] }]);
    expect([stated.low, stated.high]).toEqual([292, 360]);
    expect(stated.lines[0].rowHash).toBe(merged.priceBook.byId[row.id].hash);
  });
  it("an inactive or malformed client row never reaches the pack", () => {
    const rows = cleanFirmRows([rate({ active: false }), { work: "x", low: 1 }, { work: "Valid rate", low: 50 }, "junk"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].work).toBe("Valid rate");
    expect(toPriceBookRow(rows[0])).toMatchObject({ status: "confirmed", firm: true, qty: { kind: "count", default: 1 } });
  });
});

describe("offering rates on similar findings", () => {
  const rows = [
    rate({ work: "Bathroom damp remediation", trade: "damp", low: 146 }),
    rate({ work: "Replace extractor fan", trade: "electrical", low: 220 }),
    rate({ work: "Redecorate ceiling after leak", trade: "decoration", low: 180 }),
  ];
  it("matches on wording, best first, and ignores unrelated rows", () => {
    const s = suggestRows({ title: "Damp and mould to bathroom wall", works: "Treat the damp-affected wall and redecorate." }, rows);
    expect(s.map((r) => r.work)).toEqual(["Bathroom damp remediation"]);
    const fan = suggestRows({ title: "Extractor fan not working", issueTitle: "Extractor", works: "Replace the extractor fan with a humidistat unit." }, rows);
    expect(fan[0].work).toBe("Replace extractor fan");
  });
  it("offers nothing for a finding with no overlap, and skips inactive rows", () => {
    expect(suggestRows({ title: "Cracked window pane" }, rows)).toEqual([]);
    expect(suggestRows({ title: "Bathroom damp" }, [{ ...rows[0], active: false }])).toEqual([]);
  });
});

describe("captions", () => {
  it("are capitalised, single-spaced and without a trailing full stop", () => {
    expect(tidyCaption("  mould growth to   ceiling above shower. ")).toBe("Mould growth to ceiling above shower");
    expect(tidyCaption("")).toBe("");
  });
});
