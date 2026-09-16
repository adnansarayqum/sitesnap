// Fills MLA's actual report template (.xlsm) directly.
//
// CORRECTED from an earlier version of this file that assumed DATA ENTRY 2
// alone drove the whole report via formula, the way it looks like it
// should. That assumption was wrong, caught by re-verifying with
// deliberately nonsense test text instead of realistic Shah-style
// phrasing (which had been coincidentally matching the template's own
// stale example content and passing as a false positive). In the real
// template, only the Room/Area label is formula-linked (DATA ENTRY 2 →
// DATA ENTRY via XLOOKUP) — Issue of Concern, Site Findings, Causation,
// Remedial Works, Cost and Breach are typed directly, independently, into
// THREE places with no formula between them:
//   1. DATA ENTRY                — the working sheet, 8 pre-built item blocks
//   2. 2.0 FINDINGS AND RECOMM   — the narrative that actually prints
//      (no Breach column — it isn't restated in the narrative)
//   3. APPENDIX 1 SCOTT SCHEDULE — the summary table (no separate Issue of
//      Concern column; "Details of Disrepair" holds the Site Findings text)
// All three cap out at exactly 8 pre-built item blocks in the source
// template, consistent across all three independently. A 9th+ room is
// left out of all three and reported back via `truncated`.
//
// DATA ENTRY 2 is still written in full (all rooms, uncapped) since it
// costs nothing and keeps that tab a faithful record of what was actually
// reported, and it does drive the Room/Area label and the metadata block.
//
// Verified against the real template: filled with deliberately
// distinctive test text (not realistic phrasing, so a match can only mean
// it's genuinely reading the new data), round-tripped through
// LibreOffice's recalculation, and read back page by page — narrative,
// Scott Schedule, and every subtotal/VAT/total figure confirmed correct.
import JSZip from "jszip";
import { applyCellWrites, clearFormulaCache, excelDateSerial } from "./xlsxCells.js";

// Every part below is sheetId → workbook rId → xl/_rels/workbook.xml.rels
// → this path, confirmed against the real file rather than assumed from a
// tab's on-screen position (that can reorder without changing the part).
const DATA_ENTRY_2_PART = "xl/worksheets/sheet1.xml";
const DATA_ENTRY_PART = "xl/worksheets/sheet3.xml";
const COVER_PART = "xl/worksheets/sheet6.xml";
const FINDINGS_PART = "xl/worksheets/sheet10.xml"; // "2.0 FINDINGS AND RECOMM"
const CONCLUSIONS_PART = "xl/worksheets/sheet11.xml"; // "3.0 CONCLUSIONS"
const SCOTT_SCHEDULE_PART = "xl/worksheets/sheet14.xml"; // "APPENDIX 1 SCOTT SCHEDULE"

const META_CELLS = {
  claimant: { ref: "C3", style: 130, type: "str" },
  reportType: { ref: "C4", style: 130, type: "str" },
  landlordSurveyorName: { ref: "C5", style: 130, type: "str" },
  caseReference: { ref: "C6", style: 130, type: "str" },
  dateOfInstruction: { ref: "C7", style: 158, type: "date" },
  defendant: { ref: "C8", style: 158, type: "str" },
  instructedBy: { ref: "C9", style: 158, type: "str" },
  propertyAddress: { ref: "C10", style: 158, type: "str" },
  inspectionDate: { ref: "C11", style: 158, type: "date" },
  reportDated: { ref: "C12", style: 158, type: "date" },
  weather: { ref: "C13", style: 130, type: "str" },
  temperature: { ref: "C14", style: 130, type: "num" },
  propertyDescription: { ref: "C15", style: 131, type: "str" },
  timeToCompleteWorks: { ref: "C17", style: 130, type: "str" },
  decanting: { ref: "C18", style: 130, type: "str" },
};

// DATA ENTRY 2's item table — one row per item, columns A (label) .. H
// (breach). Per-column style read off row 25 (its first fully-built item
// row), used verbatim for rows 25-32 and as the template for any item row
// beyond what the source file shipped pre-formatted.
const ITEM_ROW_STYLE = { A: 164, B: 2, C: 79, D: 2, E: 79, F: 2, G: 141, H: 2 };
const ITEM_FIRST_ROW = 25;
const ITEM_LAST_TEMPLATE_ROW = 32;

// DATA ENTRY's 8 pre-built item blocks: header carries "ITEM N:" (and the
// XLOOKUP that turns it into the Room/Area shown), content is 2 rows below.
const DATA_ENTRY_HEADERS = [2, 8, 14, 20, 26, 32, 38, 44];
const DATA_ENTRY_BLOCKS = DATA_ENTRY_HEADERS.map((h) => ({ content: h + 2 }));

// "2.0 FINDINGS AND RECOMM"'s 8 pre-built item blocks. Fixed offsets from
// each heading row, confirmed identical across all 8 blocks in the source
// file: room label at +2, Issue of Concern at +3, Site Findings at +6,
// Causation at +9, Remedial Works (and its Cost, column F) at +12.
const FINDINGS_HEADERS = [8, 24, 40, 56, 71, 87, 103, 119];
const FINDINGS_BLOCKS = FINDINGS_HEADERS.map((h) => ({ heading: h + 2, issue: h + 3, findings: h + 6, causation: h + 9, remedial: h + 12 }));
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"];

// APPENDIX 1 SCOTT SCHEDULE's 8 pre-built item blocks: a merged "group
// title" row one above the "Location" header row, content one below it.
// Not evenly spaced (item 8, "Additional Claim Items", sits apart from
// items 1-7) — hardcoded from the real file rather than derived.
const SCOTT_SCHEDULE_HEADERS = [9, 14, 19, 24, 29, 34, 39, 48];
const SCOTT_SCHEDULE_BLOCKS = SCOTT_SCHEDULE_HEADERS.map((h) => ({ title: h - 1, content: h + 1 }));

const MAX_MLA_ITEMS = DATA_ENTRY_BLOCKS.length;

// Formula cells whose *precedents* this filler changes but which it never
// writes to directly, so their cached <v> would otherwise stay stale —
// fullCalcOnLoad turned out not to reliably clear these under LibreOffice
// for whole-range SUM() formulas specifically (direct references and
// XLOOKUPs recalculated fine on their own). Found by grepping every sheet
// for a formula referencing a cell already in this list — a transitive
// closure, not just one hop: the Findings narrative's running totals, the
// Scott Schedule's two subtotal/VAT/total groups, Cover's hidden
// DATA-ENTRY-vs-SCOTT-SCHEDULE cross-check (flags "ERROR" on a mismatch),
// and the Conclusions section's "Total value of works" line.
const DOWNSTREAM_TOTAL_CELLS = {
  [COVER_PART]: ["L3", "L4", "L5", "M5"],
  [FINDINGS_PART]: ["K1", "K2", "K3"],
  [SCOTT_SCHEDULE_PART]: ["E43", "E44", "E45", "E52", "E53", "E54"],
  [CONCLUSIONS_PART]: ["D11"],
};

function itemWrites(items) {
  const writes = [];
  items.forEach((it, i) => {
    const r = ITEM_FIRST_ROW + i;
    writes.push(
      { ref: `A${r}`, styleId: ITEM_ROW_STYLE.A, type: "str", value: `ITEM ${i + 1}:` },
      { ref: `B${r}`, styleId: ITEM_ROW_STYLE.B, type: "str", value: (it.room || "").toUpperCase() },
      { ref: `C${r}`, styleId: ITEM_ROW_STYLE.C, type: "str", value: it.issueOfConcern || "" },
      { ref: `D${r}`, styleId: ITEM_ROW_STYLE.D, type: "str", value: it.siteFindings || "" },
      { ref: `E${r}`, styleId: ITEM_ROW_STYLE.E, type: "str", value: it.causation || "" },
      { ref: `F${r}`, styleId: ITEM_ROW_STYLE.F, type: "str", value: it.remedialWorks || "" },
      { ref: `G${r}`, styleId: ITEM_ROW_STYLE.G, type: "num", value: it.cost != null ? it.cost : "" },
      { ref: `H${r}`, styleId: ITEM_ROW_STYLE.H, type: "str", value: it.breach || "" },
    );
  });
  for (let r = ITEM_FIRST_ROW + items.length; r <= ITEM_LAST_TEMPLATE_ROW; r++) {
    for (const [col, style] of Object.entries(ITEM_ROW_STYLE)) {
      writes.push({ ref: `${col}${r}`, styleId: style, type: col === "G" ? "num" : "str", value: "" });
    }
  }
  return writes;
}

// Shared by the three capped-at-8 sheets: styleId omitted deliberately —
// each block's cells carry their own formatting in the real file (not
// identical block to block), so applyCellWrites reads it live off the
// cell being replaced rather than a hardcoded guess.
function cappedBlockWrites(items, blocks, buildRow) {
  const writes = [];
  const shown = items.slice(0, blocks.length);
  shown.forEach((it, i) => writes.push(...buildRow(blocks[i], it, i)));
  for (let i = shown.length; i < blocks.length; i++) writes.push(...buildRow(blocks[i], null, i));
  return writes;
}

function dataEntryWrites(items) {
  return cappedBlockWrites(items, DATA_ENTRY_BLOCKS, ({ content }, it) => [
    { ref: `C${content}`, type: "str", value: (it && it.issueOfConcern) || "" },
    { ref: `D${content}`, type: "str", value: (it && it.siteFindings) || "" },
    { ref: `E${content}`, type: "str", value: (it && it.causation) || "" },
    { ref: `F${content}`, type: "str", value: (it && it.remedialWorks) || "" },
    { ref: `G${content}`, type: "num", value: it && it.cost != null ? it.cost : "" },
    { ref: `H${content}`, type: "str", value: (it && it.breach) || "" },
  ]);
}

function findingsWrites(items) {
  return cappedBlockWrites(items, FINDINGS_BLOCKS, ({ heading, issue, findings, causation, remedial }, it, i) => [
    // the "Additional Claim Item" running-total formula finds its rooms
    // by wildcard-matching this exact heading text
    { ref: `A${heading}`, type: "str", value: it ? `${ROMAN[i]}. ${(it.room || "").toUpperCase()}` : "" },
    { ref: `B${issue}`, type: "str", value: (it && it.issueOfConcern) || "" },
    { ref: `B${findings}`, type: "str", value: (it && it.siteFindings) || "" },
    { ref: `B${causation}`, type: "str", value: (it && it.causation) || "" },
    { ref: `B${remedial}`, type: "str", value: (it && it.remedialWorks) || "" },
    { ref: `F${remedial}`, type: "num", value: it && it.cost != null ? it.cost : "" },
  ]);
}

function scottScheduleRow({ title, content }, it, itemNumber) {
  const location = it ? `ITEM ${itemNumber} – ${(it.room || "").toUpperCase()}` : "";
  return [
    // a merged "group title" row sits one row above the table row proper,
    // restating the location plus the Issue of Concern as a teaser —
    // easy to miss since it looks like a duplicate of the row below
    { ref: `A${title}`, type: "str", value: it ? `${location}; ${it.issueOfConcern || ""}` : "" },
    { ref: `A${content}`, type: "str", value: location },
    { ref: `B${content}`, type: "str", value: (it && it.siteFindings) || "" },
    { ref: `C${content}`, type: "str", value: (it && it.breach) || "" },
    { ref: `D${content}`, type: "str", value: (it && it.remedialWorks) || "" },
    { ref: `E${content}`, type: "num", value: it && it.cost != null ? it.cost : "" },
  ];
}

// Unlike the other three sheets, the Scott Schedule's "Additional Items"
// subtotal is a fixed row range (block 8 only — E47:E51), not a text
// match. So after placeAdditionalItemsLast() has put the additional room
// last in the sequence (for correct, consistent ITEM numbering across
// every sheet), its content here still has to land specifically in the
// last physical block, not wherever the sequence happens to reach — a
// 3-item case with an additional room can't just fill blocks 0-2.
function scottScheduleWrites(allItems) {
  const items = allItems.slice(0, SCOTT_SCHEDULE_BLOCKS.length);
  const lastBlock = SCOTT_SCHEDULE_BLOCKS.length - 1;
  const hasAdditional = items.length > 0 && /additional/i.test(items[items.length - 1].room || "");
  const regularCount = hasAdditional ? items.length - 1 : items.length;
  const writes = [];
  for (let i = 0; i < lastBlock; i++) {
    const it = i < regularCount ? items[i] : null;
    writes.push(...scottScheduleRow(SCOTT_SCHEDULE_BLOCKS[i], it, i + 1));
  }
  const additionalItem = hasAdditional ? items[items.length - 1] : null;
  writes.push(...scottScheduleRow(SCOTT_SCHEDULE_BLOCKS[lastBlock], additionalItem, items.length));
  return writes;
}

// Puts a room named "Additional Claim Items" (if any) at the very end of
// the sequence, so its ITEM number comes out last and consistent across
// every sheet this filler writes to — matching how the firm's own real
// reports are always ordered (Shah's own MLA example: items 1-7 the
// actual rooms, item 8 "Additional Claim Items"). Only one such room is
// expected from the app's own fixed room categories; if more than one
// somehow appears, they're kept in their relative order at the end.
export function placeAdditionalItemsLast(items) {
  const additional = items.filter((it) => /additional/i.test(it.room || ""));
  if (!additional.length) return items;
  const rest = items.filter((it) => !/additional/i.test(it.room || ""));
  return [...rest, ...additional];
}

function metaWrites(meta) {
  const writes = [];
  for (const [key, cell] of Object.entries(META_CELLS)) {
    const raw = meta[key];
    if (raw === undefined) continue; // leave the template's own value alone if we were told nothing
    const value = cell.type === "date" && raw ? excelDateSerial(raw) : raw;
    writes.push({ ref: cell.ref, styleId: cell.style, type: cell.type === "date" ? "num" : cell.type, value });
  }
  return writes;
}

function forceRecalc(workbookXml) {
  return /fullCalcOnLoad=/.test(workbookXml)
    ? workbookXml.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"')
    : workbookXml.replace(/<calcPr([^/]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
}

async function writeSheet(zip, part, writes, opts) {
  const file = zip.file(part);
  if (!file) throw new Error(`MLA template is missing ${part} — the template may have been re-saved with different sheets`);
  let xml = await file.async("string");
  if (writes.length) xml = applyCellWrites(xml, writes, opts);
  const staleRefs = DOWNSTREAM_TOTAL_CELLS[part];
  if (staleRefs) xml = clearFormulaCache(xml, staleRefs);
  zip.file(part, xml);
}

// `templateBytes`: the blank MLA .xlsm (an ArrayBuffer/Uint8Array/Blob —
// whatever `fetch().arrayBuffer()` on the shipped template hands back).
// `meta`: case-level fields (see META_CELLS above). `items`: one entry per
// room, in report order — { room, issueOfConcern, siteFindings, causation,
// remedialWorks, cost, breach } (see src/export/reportRows.js).
// Returns { blob, truncated }: `blob` ready for `URL.createObjectURL` /
// `navigator.share`; `truncated` is how many rooms past the template's
// 8-item cap couldn't be written, for the caller to tell the surveyor.
export async function fillMlaTemplate(templateBytes, { meta = {}, items: rawItems = [] }) {
  const items = placeAdditionalItemsLast(rawItems);
  const zip = await JSZip.loadAsync(templateBytes);

  await writeSheet(zip, DATA_ENTRY_2_PART, [...metaWrites(meta), ...itemWrites(items)], { styleTemplateRow: ITEM_ROW_STYLE });
  await writeSheet(zip, DATA_ENTRY_PART, dataEntryWrites(items));
  await writeSheet(zip, FINDINGS_PART, findingsWrites(items));
  await writeSheet(zip, SCOTT_SCHEDULE_PART, scottScheduleWrites(items));
  await writeSheet(zip, COVER_PART, []);
  await writeSheet(zip, CONCLUSIONS_PART, []);

  const workbookFile = zip.file("xl/workbook.xml");
  zip.file("xl/workbook.xml", forceRecalc(await workbookFile.async("string")));

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12" });
  return { blob, truncated: Math.max(0, items.length - MAX_MLA_ITEMS) };
}
