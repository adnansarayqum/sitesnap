// TLB's counterpart to mlaXlsm.js. Same mechanism (surgical writes into a
// worksheet's raw XML, forced recalculation on open) but a materially
// different — and more manual — wiring, confirmed by inspecting the real
// template rather than assumed from its visual similarity to MLA's.
//
// MLA's whole report reads from one tab (DATA ENTRY 2) via formulas.
// TLB's does not: only the Room/Area label is formula-linked (DATA ENTRY 2
// → DATA ENTRY via XLOOKUP). The substantive content — Issue of Concern,
// Site Findings, Causation, Remedial Works, Cost, Breach — turned out to
// be typed independently into THREE separate places with no formula
// between them:
//   1. DATA ENTRY        — the working sheet Shah sees day to day
//   2. 2.0 FINDINGS AND RECOMM — the actual narrative that prints in the
//      report (no Breach column here; it isn't restated in the narrative)
//   3. APPENDIX 1 SCOTT SCHEDULE — the summary table (no separate Issue of
//      Concern column; "Details of Disrepair" holds the Site Findings text)
// All three cap out at exactly 3 pre-built item blocks in the source
// template — consistent across all three independently, which is why this
// filler caps at 3 rather than guessing higher. A 4th+ room is left out of
// all three sheets and reported back via `truncated`, so the caller can
// tell the surveyor to add it by hand — same manual step they'd already
// need once the template's own pre-built slots run out, tool or not.
//
// DATA ENTRY 2 is still written in full (all rooms, uncapped) since it
// costs nothing and keeps that tab a faithful record of what was
// actually reported, even though the report itself doesn't read it here.
//
// "Instructed by" / "Instructing Agent" are formulas derived from the
// case reference's TLBS-/TLBR- prefix, not free text — left untouched so
// those formulas keep resolving.
import JSZip from "jszip";
import { applyCellWrites, clearFormulaCache, excelDateSerial } from "./xlsxCells.js";

const DATA_ENTRY_2_PART = "xl/worksheets/sheet1.xml";
const DATA_ENTRY_PART = "xl/worksheets/sheet3.xml";
const COVER_PART = "xl/worksheets/sheet5.xml";
const FINDINGS_PART = "xl/worksheets/sheet10.xml"; // "2.0 FINDINGS AND RECOMM"
const SCOTT_SCHEDULE_PART = "xl/worksheets/sheet14.xml"; // "APPENDIX 1 SCOTT SCHEDULE"
const CONCLUSIONS_PART = "xl/worksheets/sheet11.xml"; // "3.0 CONCLUSIONS"

// Formula cells whose *precedents* this filler changes, but which this
// filler never writes to directly — so their cached <v> would otherwise
// go stale. Confirmed by grepping every sheet in the template for a
// formula referencing a cell already in this list (a transitive closure,
// not just one hop) — the full chain: DATA ENTRY 2's own total-value
// cell, Cover's hidden DATA-ENTRY-vs-SCOTT-SCHEDULE cross-check (it flags
// "ERROR" on a mismatch — worth keeping honest), the Scott Schedule's two
// subtotal/VAT/total groups, the Findings narrative's running totals, and
// the Conclusions section's "Total value of works" line that quotes one
// of those totals back.
const DOWNSTREAM_TOTAL_CELLS = {
  [DATA_ENTRY_2_PART]: ["C18"],
  [COVER_PART]: ["L6", "L7", "L8", "M8"],
  [SCOTT_SCHEDULE_PART]: ["E18", "E19", "E20", "E27", "E28", "E29"],
  [FINDINGS_PART]: ["J1", "J2", "J3"],
  [CONCLUSIONS_PART]: ["D11"],
};

const META_CELLS = {
  inspectionDate: { ref: "C3", style: 129, type: "date" },
  reportDated: { ref: "C4", style: 129, type: "date" },
  claimant: { ref: "C5", style: 130, type: "str" },
  defendant: { ref: "C6", style: 2, type: "str" },
  caseReference: { ref: "C9", style: 129, type: "str" },
  dateOfInstruction: { ref: "C11", style: 129, type: "date" }, // "Letter of INSTRUCTION Date" — TLB's closest equivalent
  reportType: { ref: "C12", style: 130, type: "str" },
  landlordSurveyorName: { ref: "C13", style: 130, type: "str" },
  propertyAddress: { ref: "C14", style: 130, type: "str" },
  weather: { ref: "C15", style: 130, type: "str" },
  temperature: { ref: "C16", style: 130, type: "num" },
  propertyDescription: { ref: "C17", style: 131, type: "str" },
  timeToCompleteWorks: { ref: "C19", style: 130, type: "str" },
  decanting: { ref: "C20", style: 130, type: "str" },
  conditionInternally: { ref: "C21", style: 129, type: "str" },
  conditionExternally: { ref: "C22", style: 129, type: "str" },
};

// DATA ENTRY 2's item table — one column right of MLA's (B..I, not A..H).
const ITEM_ROW_STYLE = { B: 283, C: 283, D: 283, E: 283, F: 284, G: 283, H: 285, I: 284 };
const ITEM_FIRST_ROW = 28;
const ITEM_LAST_TEMPLATE_ROW = 30;

// The three sheets' pre-built item blocks, each independently capped at 3
// in the source template. Row numbers are hardcoded rather than computed
// from a stride because APPENDIX 1's isn't evenly spaced (10, 15, 24 —
// item 3's block runs longer than item 2's, presumably from wrapped text).
const DATA_ENTRY_BLOCKS = [{ content: 4 }, { content: 10 }, { content: 16 }];
const FINDINGS_BLOCKS = [
  { heading: 10, issue: 11, findings: 14, causation: 17, remedial: 20 },
  { heading: 26, issue: 27, findings: 30, causation: 33, remedial: 36 },
  { heading: 42, issue: 43, findings: 46, causation: 49, remedial: 52 },
];
const ROMAN = ["i", "ii", "iii"];
const SCOTT_SCHEDULE_BLOCKS = [{ title: 8, content: 10 }, { title: 13, content: 15 }, { title: 22, content: 24 }];
const MAX_TLB_ITEMS = DATA_ENTRY_BLOCKS.length;

function itemWrites(items) {
  const writes = [];
  items.forEach((it, i) => {
    const r = ITEM_FIRST_ROW + i;
    writes.push(
      { ref: `B${r}`, styleId: ITEM_ROW_STYLE.B, type: "str", value: `ITEM ${i + 1}:` },
      { ref: `C${r}`, styleId: ITEM_ROW_STYLE.C, type: "str", value: (it.room || "").toUpperCase() },
      { ref: `D${r}`, styleId: ITEM_ROW_STYLE.D, type: "str", value: it.issueOfConcern || "" },
      { ref: `E${r}`, styleId: ITEM_ROW_STYLE.E, type: "str", value: it.siteFindings || "" },
      { ref: `F${r}`, styleId: ITEM_ROW_STYLE.F, type: "str", value: it.causation || "" },
      { ref: `G${r}`, styleId: ITEM_ROW_STYLE.G, type: "str", value: it.remedialWorks || "" },
      { ref: `H${r}`, styleId: ITEM_ROW_STYLE.H, type: "num", value: it.cost != null ? it.cost : "" },
      { ref: `I${r}`, styleId: ITEM_ROW_STYLE.I, type: "str", value: it.breach || "" },
    );
  });
  for (let r = ITEM_FIRST_ROW + items.length; r <= ITEM_LAST_TEMPLATE_ROW; r++) {
    for (const [col, style] of Object.entries(ITEM_ROW_STYLE)) {
      writes.push({ ref: `${col}${r}`, styleId: style, type: col === "H" ? "num" : "str", value: "" });
    }
  }
  return writes;
}

// Shared by the three capped-at-3 sheets: styleId omitted deliberately —
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
    // the "Additional Items Subtotal" line elsewhere on this sheet finds
    // its rooms by wildcard-matching this exact heading text, so the
    // room name has to land here, not just in the content rows below
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

// Unlike the other two sheets, the Scott Schedule's "Additional Items"
// subtotal (and VAT/total) is a fixed CELL RANGE, not a text match —
// whatever physically sits in the last block is summed into that bucket,
// whatever it's actually called. So this function must never put a plain
// room into the last block just because there happen to be enough items
// to fill it: doing that once (an earlier version of this fix) silently
// re-labelled a real room's cost as an "additional item" in the printed
// report — wrong in a different way than dropping it, not better. The
// last block is reserved for a genuine "Additional Claim Items" room, or
// left blank; callers are responsible for capping how many *regular*
// rooms they ever hand this function to `blocks.length - 1` (see
// capForPrint below) so a real room is never silently placed here.
export function scottScheduleWrites(allItems) {
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

// The true, safe cap on *regular* rooms this template can print without
// either dropping one or mislabelling one as "additional" (filling the
// last, fixed-range block with a room that isn't). TLB's cap of exactly
// 3 makes this the common case, not an edge case: most real 3-room cases
// have no catch-all "additional" bucket at all, so the real cap for them
// is 2, with the 3rd flagged via `truncated` for the surveyor to add by
// hand — never silently dropped or silently mislabelled.
export function capForPrint(items, blockCount) {
  const hasAdditional = items.length > 0 && /additional/i.test(items[items.length - 1].room || "");
  return items.slice(0, hasAdditional ? blockCount : blockCount - 1);
}

// Puts a room named "Additional Claim Items" (if any) at the very end of
// the sequence, so its ITEM number comes out last and consistent across
// every sheet this filler writes to. See mlaXlsm.js for the same helper.
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
    if (raw === undefined) continue;
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
  if (!file) throw new Error(`TLB template is missing ${part} — template may have been re-saved with different sheets`);
  let xml = await file.async("string");
  if (writes.length) xml = applyCellWrites(xml, writes, opts);
  const staleRefs = DOWNSTREAM_TOTAL_CELLS[part];
  if (staleRefs) xml = clearFormulaCache(xml, staleRefs);
  zip.file(part, xml);
}

// Same shape as fillMlaTemplate (see src/export/mlaXlsm.js) but also
// returns `truncated`: how many rooms past the shared 3-item cap couldn't
// be written, so the caller can tell the surveyor.
export async function fillTlbTemplate(templateBytes, { meta = {}, items: rawItems = [] }) {
  const items = placeAdditionalItemsLast(rawItems);
  // DATA ENTRY 2 keeps the full, uncapped list — the other three printed
  // sheets share one consistent, correctly-capped list so a room is never
  // shown in the narrative but missing (or mislabelled) in the Scott
  // Schedule.
  const printed = capForPrint(items, MAX_TLB_ITEMS);
  const zip = await JSZip.loadAsync(templateBytes);

  await writeSheet(zip, DATA_ENTRY_2_PART, [...metaWrites(meta), ...itemWrites(items)], { styleTemplateRow: ITEM_ROW_STYLE });
  await writeSheet(zip, DATA_ENTRY_PART, dataEntryWrites(printed));
  await writeSheet(zip, FINDINGS_PART, findingsWrites(printed));
  await writeSheet(zip, SCOTT_SCHEDULE_PART, scottScheduleWrites(printed));
  await writeSheet(zip, COVER_PART, []);
  await writeSheet(zip, CONCLUSIONS_PART, []);

  const workbookFile = zip.file("xl/workbook.xml");
  zip.file("xl/workbook.xml", forceRecalc(await workbookFile.async("string")));

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12" });
  return { blob, truncated: Math.max(0, items.length - printed.length) };
}
