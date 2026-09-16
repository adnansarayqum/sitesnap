// Surgical cell writes into an OOXML worksheet's raw XML — the alternative
// to loading the whole workbook through a spreadsheet library (openpyxl,
// exceljs) and re-serialising it. A full round-trip through those tools
// drops things they don't fully model: embedded shapes/logos, some data
// validation extensions, the VBA project. Editing only the <c> elements we
// mean to change leaves every other part of the .xlsm — Cover page
// letterhead, drawings, macros, every other sheet's formulas — byte for
// byte untouched.
//
// Values are written as inline strings (t="inlineStr") rather than shared
// strings, so sharedStrings.xml (and its uniqueCount/count bookkeeping)
// never needs touching either.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const colLetters = (ref) => ref.match(/^[A-Z]+/)[0];
const rowNumber = (ref) => Number(ref.match(/\d+$/)[0]);
const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);

function cellXml(ref, styleId, spec) {
  const s = styleId != null ? ` s="${styleId}"` : "";
  if (spec == null || spec.value === "" || spec.value == null) return `<c r="${ref}"${s}/>`;
  if (spec.type === "str") return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(spec.value)}</t></is></c>`;
  // numeric (plain number or an Excel date serial — dates are just numbers with a date-formatted style)
  return `<c r="${ref}"${s}><v>${Number(spec.value)}</v></c>`;
}

// Replaces (or inserts) a set of cells across one or more rows in a
// worksheet's XML. `writes` is [{ ref: "C7", styleId: 158, type: "num"|"str", value }].
// `styleTemplateRow` (optional) supplies per-column style ids to use when a
// target row does not exist yet in the sheet and must be created — needed
// for item rows beyond however many the source template shipped with.
export function applyCellWrites(sheetXml, writes, { styleTemplateRow } = {}) {
  const byRow = new Map();
  for (const w of writes) {
    const r = rowNumber(w.ref);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(w);
  }

  let xml = sheetXml;
  for (const [r, cellWrites] of byRow) {
    const rowRe = new RegExp(`<row r="${r}"[^>]*>([\\s\\S]*?)<\\/row>`);
    const m = xml.match(rowRe);
    if (m) {
      let inner = m[1];
      for (const w of cellWrites) {
        const styleId = w.styleId != null ? w.styleId : cellStyleFromRow(inner, w.ref);
        const cellRe = new RegExp(`<c r="${w.ref}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
        const replacement = cellXml(w.ref, styleId, w);
        inner = cellRe.test(inner) ? inner.replace(cellRe, replacement) : insertCellSorted(inner, w.ref, replacement);
      }
      xml = xml.replace(rowRe, `<row r="${r}"${m[0].match(/^<row r="\d+"([^>]*)>/)[1]}>${inner}</row>`);
    } else {
      // the row doesn't exist yet (a case with more items than the
      // template shipped example rows for) — build it from the style
      // template row's per-column styles
      const cells = cellWrites
        .map((w) => cellXml(w.ref, w.styleId != null ? w.styleId : (styleTemplateRow || {})[colLetters(w.ref)], w))
        .sort((a, b) => colIndex(colLetters(a.match(/r="([A-Z]+)\d+"/)[1])) - colIndex(colLetters(b.match(/r="([A-Z]+)\d+"/)[1])));
      const newRow = `<row r="${r}" spans="1:26">${cells.join("")}</row>`;
      xml = insertRowSorted(xml, r, newRow);
    }
  }
  return xml;
}

function cellStyleFromRow(rowInner, ref) {
  const m = rowInner.match(new RegExp(`<c r="${ref}" s="(\\d+)"`));
  return m ? Number(m[1]) : null;
}

function insertCellSorted(rowInner, ref, cellXmlStr) {
  const target = colIndex(colLetters(ref));
  const cellRe = /<c r="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g;
  let m, insertAt = rowInner.length;
  while ((m = cellRe.exec(rowInner))) {
    if (colIndex(m[1]) > target) { insertAt = m.index; break; }
  }
  return rowInner.slice(0, insertAt) + cellXmlStr + rowInner.slice(insertAt);
}

function insertRowSorted(sheetXml, r, newRowXml) {
  const rowRe = /<row r="(\d+)"[^>]*>[\s\S]*?<\/row>|<row r="(\d+)"[^>]*\/>/g;
  let m, insertAt = null;
  while ((m = rowRe.exec(sheetXml))) {
    const rn = Number(m[1] || m[2]);
    if (rn > r) { insertAt = m.index; break; }
  }
  if (insertAt == null) {
    const closeIdx = sheetXml.indexOf("</sheetData>");
    return sheetXml.slice(0, closeIdx) + newRowXml + sheetXml.slice(closeIdx);
  }
  return sheetXml.slice(0, insertAt) + newRowXml + sheetXml.slice(insertAt);
}

// Days since 1899-12-30, the epoch Excel's date serials use (UTC, so a
// "YYYY-MM-DD" string always lands on the same calendar day regardless of
// the server's local timezone).
export function excelDateSerial(isoDateStr) {
  const [y, mo, d] = isoDateStr.split("-").map(Number);
  const epoch = Date.UTC(1899, 11, 30);
  const day = Date.UTC(y, mo - 1, d);
  return Math.round((day - epoch) / 86400000);
}
