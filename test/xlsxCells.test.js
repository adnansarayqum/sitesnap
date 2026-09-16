// The raw OOXML cell-surgery helpers the MLA export is built on. These are
// tested directly against small hand-built worksheet XML fragments — the
// full round-trip against the real template is verified separately (see
// src/export/mlaXlsm.js's header comment), but the string/XML mechanics
// here are exactly what would silently corrupt a report if they drifted.
import { describe, expect, it } from "vitest";
import { applyCellWrites, excelDateSerial } from "../src/export/xlsxCells.js";

describe("excelDateSerial", () => {
  it("matches Excel's day-count from 1899-12-30", () => {
    expect(excelDateSerial("2026-08-04")).toBe(46238); // confirmed against a real MLA template cell
    expect(excelDateSerial("2026-09-10")).toBe(46275);
  });
});

describe("applyCellWrites", () => {
  const sheet = `<sheetData><row r="25" spans="1:8"><c r="A25" s="164" t="s"><v>83</v></c><c r="B25" s="2" t="s"><v>432</v></c><c r="G25" s="141"><v>340</v></c></row><row r="30" spans="1:8"><c r="A30" s="164"/></row></sheetData>`;

  it("replaces an existing string cell with an inline string, keeping its style", () => {
    const out = applyCellWrites(sheet, [{ ref: "A25", styleId: 164, type: "str", value: "ITEM 1:" }]);
    expect(out).toContain('<c r="A25" s="164" t="inlineStr"><is><t xml:space="preserve">ITEM 1:</t></is></c>');
    expect(out).not.toContain("<v>83</v>"); // the old shared-string reference is gone, not left dangling
  });

  it("replaces a numeric cell's value without adding a type attribute", () => {
    const out = applyCellWrites(sheet, [{ ref: "G25", styleId: 141, type: "num", value: 725 }]);
    expect(out).toContain('<c r="G25" s="141"><v>725</v></c>');
  });

  it("escapes XML-significant characters in written text", () => {
    const out = applyCellWrites(sheet, [{ ref: "B25", styleId: 2, type: "str", value: 'Tom & Jerry <ltd> "quoted"' }]);
    expect(out).toContain("Tom &amp; Jerry &lt;ltd&gt;");
  });

  it("clears a cell to empty (self-closing) when the value is blank", () => {
    const out = applyCellWrites(sheet, [{ ref: "B25", styleId: 2, type: "str", value: "" }]);
    expect(out).toMatch(/<c r="B25" s="2"\/>/);
  });

  it("inserts a new cell into an existing row in column order", () => {
    const out = applyCellWrites(sheet, [{ ref: "C25", styleId: 79, type: "str", value: "middle" }]);
    // C25 must land between A25/B25 and G25, not appended after G25
    const iB = out.indexOf('r="B25"');
    const iC = out.indexOf('r="C25"');
    const iG = out.indexOf('r="G25"');
    expect(iB).toBeLessThan(iC);
    expect(iC).toBeLessThan(iG);
  });

  it("builds a brand-new row not present in the source sheet, from the style template, in the correct sorted position", () => {
    // row 27 doesn't exist in the fixture (only 25 and 30 do) — it must be
    // built from scratch and land between them, not appended at the end
    const out = applyCellWrites(
      sheet,
      [{ ref: "A27", type: "str", value: "ITEM 3:" }, { ref: "B27", type: "str", value: "LOFT" }, { ref: "G27", type: "num", value: 50 }],
      { styleTemplateRow: { A: 164, B: 2, C: 79, D: 2, E: 79, F: 2, G: 141, H: 2 } }
    );
    expect(out).toContain('<row r="27"');
    expect(out).toContain('<c r="A27" s="164" t="inlineStr"><is><t xml:space="preserve">ITEM 3:</t></is></c>');
    expect(out).toContain('<c r="G27" s="141"><v>50</v></c>');
    expect(out.indexOf('r="25"')).toBeLessThan(out.indexOf('<row r="27"'));
    expect(out.indexOf('<row r="27"')).toBeLessThan(out.indexOf('r="30"'));
  });

  it("appends a new row after the last existing row when its number is higher than all of them", () => {
    const out = applyCellWrites(sheet, [{ ref: "A40", type: "str", value: "x" }], { styleTemplateRow: { A: 164 } });
    expect(out.indexOf('r="30"')).toBeLessThan(out.indexOf('<row r="40"'));
    expect(out.trim().endsWith("</sheetData>")).toBe(true);
  });
});
