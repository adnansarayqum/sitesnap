// Scenarios 6, 7 and the "valid-but-wrong row" case: the server owns every
// number; the model only proposes rows and quantities it can evidence.
import { describe, expect, it } from "vitest";
import { loadReference, priceItems, resolveLegal, resolveHazard, applyTradeMinimums } from "../server/reference.js";

const ref = loadReference(true);

describe("deterministic pricing", () => {
  it("S6: an unknown price-book id yields no monetary value", () => {
    const r = priceItems(ref, [{ price_book_row_id: "PB-DOES-NOT-EXIST", quantity: 3, quantity_basis: "observed", quantity_evidence: ["PHOTO-1"] }]);
    expect(r.unpriced).toBe(true);
    expect(r.low).toBeNull();
    expect(r.problems[0].problem).toBe("unknown_row");
    expect(r.flags).toContain("unpriced");
  });

  it("S7: a measure row with an unknown quantity stays unpriced — no area is invented", () => {
    const r = priceItems(ref, [{ price_book_row_id: "REPOINT-LOCAL", quantity: 0, quantity_basis: "unknown", quantity_evidence: [] }]);
    expect(r.unpriced).toBe(true);
    expect(r.problems[0].problem).toBe("quantity_required");
    expect(r.flags).toEqual(expect.arrayContaining(["quantity_unconfirmed", "unpriced"]));
    // an "observed" area with no evidence ids is not believed either
    expect(priceItems(ref, [{ price_book_row_id: "REPOINT-LOCAL", quantity: 6, quantity_basis: "observed", quantity_evidence: [] }]).unpriced).toBe(true);
  });

  it("S7b: the surveyor entering the quantity prices it deterministically from the book", () => {
    const r = priceItems(ref, [{ price_book_row_id: "REPOINT-LOCAL", quantity: 0, quantity_basis: "unknown", quantity_evidence: [] }], { "REPOINT-LOCAL": 3 });
    const row = ref.priceBook.byId["REPOINT-LOCAL"];
    expect(r.unpriced).toBe(false);
    expect(r.low).toBe(row.low * 3);
    expect(r.high).toBe(row.high * 3);
    expect(r.lines[0].qtySource).toBe("surveyor");
    expect(r.priceBookVersion).toBe(`v${ref.priceBook.version}`);
    expect(r.basis).toMatch(/entered/);
  });

  it("a count row without an evidenced count uses the book's default and is flagged as an assumption", () => {
    const r = priceItems(ref, [{ price_book_row_id: "MOULD-WALL", quantity: 0, quantity_basis: "unknown", quantity_evidence: [] }]);
    expect(r.unpriced).toBe(false);
    expect(r.lines[0].qty).toBe(1);
    expect(r.lines[0].qtySource).toBe("assumed");
    expect(r.flags).toEqual(expect.arrayContaining(["price_assumption", "quantity_unconfirmed"]));
  });

  it("a count row that requires evidence (MOULD-REVEAL: per window) is not assumed", () => {
    const r = priceItems(ref, [{ price_book_row_id: "MOULD-REVEAL", quantity: 0, quantity_basis: "assumed", quantity_evidence: [] }]);
    expect(r.unpriced).toBe(true);
    expect(r.problems[0].problem).toBe("quantity_required");
    const ok = priceItems(ref, [{ price_book_row_id: "MOULD-REVEAL", quantity: 2, quantity_basis: "observed", quantity_evidence: ["PHOTO-3", "PHOTO-4"] }]);
    expect(ok.unpriced).toBe(false);
    expect(ok.low).toBe(ref.priceBook.byId["MOULD-REVEAL"].low * 2);
  });

  it("valid-but-wrong: two mutually exclusive rows in one finding are refused, not summed", () => {
    const r = priceItems(ref, [
      { price_book_row_id: "CEIL-CRACK-LOCAL", quantity: 1, quantity_basis: "assumed", quantity_evidence: [] },
      { price_book_row_id: "CEIL-MAKE-GOOD", quantity: 1, quantity_basis: "assumed", quantity_evidence: [] },
    ]);
    expect(r.unpriced).toBe(true);
    expect(r.problems.filter((p) => p.problem === "overlap").length).toBe(2);
  });

  it("a duplicate row is merged, an inactive row refused, arithmetic is exact", () => {
    const dup = priceItems(ref, [
      { price_book_row_id: "SEALANT-BATH", quantity: 1, quantity_basis: "observed", quantity_evidence: ["PHOTO-1"] },
      { price_book_row_id: "SEALANT-BATH", quantity: 1, quantity_basis: "observed", quantity_evidence: ["PHOTO-2"] },
    ]);
    expect(dup.lines.length).toBe(1);
    expect(dup.problems[0].problem).toBe("duplicate_row");
    const inactive = { ...ref, priceBook: { ...ref.priceBook, byId: { ...ref.priceBook.byId, OLD: { id: "OLD", active: false, low: 1, high: 2, qty: { kind: "count", default: 1 } } } } };
    expect(priceItems(inactive, [{ price_book_row_id: "OLD", quantity: 1, quantity_basis: "assumed" }]).problems[0].problem).toBe("inactive_row");
    const two = priceItems(ref, [
      { price_book_row_id: "MOULD-WALL", quantity: 2, quantity_basis: "observed", quantity_evidence: ["PHOTO-1", "PHOTO-2"] },
      { price_book_row_id: "EXTRACT-FAN-REPLACE", quantity: 1, quantity_basis: "stated", quantity_evidence: ["NOTE-1"] },
    ]);
    const a = ref.priceBook.byId["MOULD-WALL"], b = ref.priceBook.byId["EXTRACT-FAN-REPLACE"];
    expect(two.low).toBe(a.low * 2 + b.low);
    expect(two.high).toBe(a.high * 2 + b.high);
    expect(two.flags).not.toContain("unpriced");
  });
});

describe("trade minimums (a case-wide reasonableness floor)", () => {
  it("every priced line carries the trade its row belongs to", () => {
    const r = priceItems(ref, [{ price_book_row_id: "CEIL-CRACK-LOCAL", quantity: 1, quantity_basis: "assumed", quantity_evidence: [] }]);
    expect(r.lines[0].trade).toBe("plasterer_decorator");
  });

  it("two small same-trade lines across different findings are floored to one realistic visit, not summed as two tiny jobs", () => {
    // Shah's own example: two 2m2-ish plaster patches that separately sum
    // to far less than a plasterer would actually charge to attend once
    const a = priceItems(ref, [{ price_book_row_id: "CEIL-CRACK-LOCAL", quantity: 1, quantity_basis: "assumed", quantity_evidence: [] }], { "CEIL-CRACK-LOCAL": 1 });
    const b = priceItems(ref, [{ price_book_row_id: "MOULD-WALL", quantity: 1, quantity_basis: "assumed", quantity_evidence: [] }]);
    const naiveSum = a.lines[0].low + b.lines[0].low;
    const adj = applyTradeMinimums(ref.priceBook.trades, [...a.lines, ...b.lines]);
    const plasterer = adj.adjustments.find((x) => x.trade === "plasterer_decorator");
    expect(plasterer).toBeTruthy();
    expect(plasterer.from.low).toBe(naiveSum);
    expect(plasterer.to.low).toBe(ref.priceBook.trades.plasterer_decorator.minimum.low);
    expect(plasterer.to.low).toBeGreaterThan(naiveSum);
    expect(adj.addedLow).toBe(plasterer.to.low - naiveSum);
  });

  it("a trade already above its minimum, or with no minimum set, is left exactly as summed", () => {
    const big = priceItems(ref, [{ price_book_row_id: "CEIL-MAKE-GOOD", quantity: 1, quantity_basis: "assumed", quantity_evidence: [] }]);
    const aboveFloor = applyTradeMinimums(ref.priceBook.trades, big.lines);
    expect(aboveFloor.adjustments).toEqual([]);
    expect(aboveFloor.addedLow).toBe(0);

    const plumber = priceItems(ref, [{ price_book_row_id: "SEALANT-BATH", quantity: 1, quantity_basis: "assumed", quantity_evidence: [] }]);
    expect(ref.priceBook.trades.plumber.minimum).toBeNull(); // nothing confirmed yet
    const noFloor = applyTradeMinimums(ref.priceBook.trades, plumber.lines);
    expect(noFloor.adjustments).toEqual([]);
  });

  it("unpriced or trade-less lines are ignored rather than crashing the grouping", () => {
    const r = applyTradeMinimums(ref.priceBook.trades, [{ priced: false, trade: "plasterer_decorator", low: 5, high: 5 }, { priced: true, trade: null, low: 5, high: 5, row_id: "X" }]);
    expect(r.adjustments).toEqual([]);
    expect(r.addedLow).toBe(0);
  });
});

describe("controlled legal references", () => {
  it("S8: an unknown legal id is rejected; known ids resolve to the canonical citation and carry the entry hash", () => {
    const r = resolveLegal(ref, [{ legal_register_id: "LEGAL-S11-LTA", reason: "penetrating damp" }, { legal_register_id: "LEGAL-MADE-UP", reason: "x" }, { legal_register_id: "LEGAL-S11-LTA" }]);
    expect(r.refs.length).toBe(1);
    expect(r.refs[0].cite).toBe("S11 LTA");
    expect(r.refs[0].hash).toMatch(/^[0-9a-f]{12}$/);
    expect(r.rejected).toEqual([{ id: "LEGAL-MADE-UP", reason: "unknown legal register id" }]);
    expect(resolveLegal(ref, []).refs).toEqual([]);
  });
  it("HHSRS hazards come only from the controlled list, in the firm's form", () => {
    // 2026 numbering (Operating Guidance in force 23 June 2026): damp and mould is 11
    expect(resolveHazard(ref, { hazard_id: "HHSRS-11", category: "Cat 2", confidence: "medium" }).hazard.label).toBe("Cat 2 Risk Hazard 11");
    expect(ref.hhsrs.byId["HHSRS-11"].name).toBe("Damp and mould growth");
    // the list is the 21 of the 2026 guidance, not the 29 of 2006 — an id past the cap is rejected
    expect(ref.hhsrs.hazards).toHaveLength(21);
    expect(resolveHazard(ref, { hazard_id: "HHSRS-22" }).rejected.reason).toMatch(/unknown HHSRS/);
    expect(resolveHazard(ref, { hazard_id: "HHSRS-29" }).rejected.reason).toMatch(/unknown HHSRS/);
    expect(resolveHazard(ref, { hazard_id: "HHSRS-99" }).rejected.reason).toMatch(/unknown HHSRS/);
    expect(resolveHazard(ref, null).hazard).toBeNull();
  });
});
