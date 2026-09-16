// Fills MLA's actual report template (.xlsm) directly — case metadata and
// one row per finding-room into the DATA ENTRY 2 tab, which is the exact
// paste target Shah's own "Excel-ready TSV" GPT already produces. Every
// other tab (the narrative, Scott Schedule, photo schedule, HHSRS appendix)
// reads DATA ENTRY 2 through formulas already built into the template —
// this only ever writes into that one tab plus a short metadata block, so
// letterhead, macros and every formula elsewhere stay exactly as supplied.
//
// Verified against the firm's real template: filled, then round-tripped
// through LibreOffice's recalculation, and read back page by page — the
// narrative, Scott Schedule and cost/breach columns all picked up the
// injected data correctly. (The template's own page also shows a few
// alternate-wording reference boxes, e.g. F15's "maisonette" example text
// — those are the surveyor's phrasing options, not live fields; don't
// mistake them for stale data if they still show the source example.)
import JSZip from "jszip";
import { applyCellWrites, excelDateSerial } from "./xlsxCells.js";

// DATA ENTRY 2 is sheetId 15 / workbook rId1, which maps to this part in
// every copy of the template we've seen — confirmed against the real
// file's xl/_rels/workbook.xml.rels, not assumed from the tab's on-screen
// position (that can reorder without changing the underlying part name).
const DATA_ENTRY_2_PART = "xl/worksheets/sheet1.xml";

// Cell → style id, read directly off the template's own XML so a replaced
// cell keeps its exact formatting. `str` cells are plain text; `date`
// cells are Excel date serials (days since 1899-12-30); `num` is a plain
// number.
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

// Per-column style, read off DATA_ENTRY_2's row 25 (its first fully-built
// item row) — used verbatim for rows 25-32 and as the template for any
// item row beyond what the source file shipped pre-formatted.
const ITEM_ROW_STYLE = { A: 164, B: 2, C: 79, D: 2, E: 79, F: 2, G: 141, H: 2 };
const ITEM_FIRST_ROW = 25;
const ITEM_LAST_TEMPLATE_ROW = 32; // beyond this, new rows are built from ITEM_ROW_STYLE rather than replaced

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
  // Blank every row the template pre-built beyond the items actually
  // supplied, up to the last row the source example used — so a shorter
  // case never leaves a stray example row behind.
  for (let r = ITEM_FIRST_ROW + items.length; r <= ITEM_LAST_TEMPLATE_ROW; r++) {
    for (const [col, style] of Object.entries(ITEM_ROW_STYLE)) {
      writes.push({ ref: `${col}${r}`, styleId: style, type: col === "G" ? "num" : "str", value: "" });
    }
  }
  return writes;
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

// `templateBytes`: the blank MLA .xlsm (an ArrayBuffer/Uint8Array/Blob —
// whatever `fetch().arrayBuffer()` on the shipped template hands back).
// `meta`: case-level fields (see META_CELLS above). `items`: one entry per
// room, in report order — { room, issueOfConcern, siteFindings, causation,
// remedialWorks, cost, breach } (see src/export/reportRows.js).
// Returns a Blob ready for `URL.createObjectURL` / `navigator.share`.
export async function fillMlaTemplate(templateBytes, { meta = {}, items = [] }) {
  const zip = await JSZip.loadAsync(templateBytes);

  const sheetFile = zip.file(DATA_ENTRY_2_PART);
  if (!sheetFile) throw new Error(`MLA template is missing ${DATA_ENTRY_2_PART} — the template may have been re-saved with a different sheet order`);
  let sheetXml = await sheetFile.async("string");
  sheetXml = applyCellWrites(sheetXml, [...metaWrites(meta), ...itemWrites(items)], { styleTemplateRow: ITEM_ROW_STYLE });
  zip.file(DATA_ENTRY_2_PART, sheetXml);

  // Cached formula results elsewhere in the workbook (the narrative, Scott
  // Schedule, HHSRS appendix) would otherwise show stale values from
  // whatever the template last had open in Excel — force a full
  // recalculation the moment the file is opened.
  const workbookFile = zip.file("xl/workbook.xml");
  let workbookXml = await workbookFile.async("string");
  workbookXml = /fullCalcOnLoad=/.test(workbookXml)
    ? workbookXml.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"')
    : workbookXml.replace(/<calcPr([^/]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  zip.file("xl/workbook.xml", workbookXml);

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12" });
}
