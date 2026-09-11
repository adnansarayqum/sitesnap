// The surveyor's own rates — the cost library that builds up from live jobs.
// A rate is a price-book row the firm wrote itself: what the work is, which
// trade, a figure (or a range) and the finding it was first used on. Rows
// are offered on similar findings and given to the analysis stage as rows it
// may pick; the server still does every multiplication. Plain JS, no
// imports, so the phone and the server validate identically.

export const FIRM_PREFIX = "FIRM-";
export const isFirmRowId = (id) => typeof id === "string" && id.startsWith(FIRM_PREFIX);

export function newFirmRowId(rand = Math.random) {
  const t = Date.now().toString(36).slice(-4);
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  return `${FIRM_PREFIX}${t}${r}`.toUpperCase();
}

const text = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const money = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

// { ok, row } or { ok: false, error }. `high` defaults to `low` (a single
// figure); a reversed range is put the right way round rather than refused.
export function normaliseRow(input) {
  const i = input && typeof input === "object" ? input : {};
  const work = text(i.work, 300);
  if (work.length < 3) return { ok: false, error: "Say what the rate is for (at least three characters)." };
  const lowIn = money(i.low);
  if (lowIn == null) return { ok: false, error: "Give a figure in pounds." };
  const highIn = i.high === "" || i.high == null ? lowIn : money(i.high);
  if (highIn == null) return { ok: false, error: "The high figure must be a number." };
  const low = Math.min(lowIn, highIn), high = Math.max(lowIn, highIn);
  return {
    ok: true,
    row: {
      id: isFirmRowId(i.id) ? text(i.id, 40) : newFirmRowId(),
      work, trade: text(i.trade, 60), unit: text(i.unit, 60) || "per item",
      low, high, notes: text(i.notes, 400),
      active: i.active !== false,
      sourceCaseId: text(i.sourceCaseId, 120) || null, sourceFindingId: text(i.sourceFindingId, 120) || null, sourceTitle: text(i.sourceTitle, 160) || null,
      createdAt: i.createdAt || new Date().toISOString(),
    },
  };
}

// the shape server/reference.js prices from and the analysis stage sees
export function toPriceBookRow(r) {
  return {
    id: r.id,
    work: r.trade ? `${r.work} (${r.trade})` : r.work,
    unit: r.unit || "per item", low: r.low, high: r.high,
    status: "confirmed", active: r.active !== false, firm: true,
    qty: { kind: "count", unit: "item", default: 1, evidence: "assumable" },
    excludes: [],
    source: `the firm's own rate${r.sourceTitle ? ` — first used on "${r.sourceTitle}"` : ""}`,
    notes: `A rate this firm has used before.${r.notes ? ` ${r.notes}` : ""}`,
  };
}

// ---- matching a finding to the rates it may want ----------------------------------
const STOP = new Set(["with", "from", "that", "this", "were", "was", "the", "and", "area", "areas", "affected", "should", "been", "have", "has", "into", "onto", "over", "under", "which", "where", "when", "then", "than", "them", "they", "their", "there", "these", "those", "also", "very", "some", "such", "each", "other", "more", "most", "time", "inspection", "observed", "noted", "recorded", "room", "property", "finding", "works", "work", "appropriate", "necessary", "required", "including", "subject", "results", "balance", "probabilities", "considered"]);
export function tokenise(s) {
  const out = new Set();
  for (const w of String(s || "").toLowerCase().split(/[^a-z]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w);
  }
  return out;
}

// Rows whose wording overlaps the finding's, best first. A short row ("Mould
// treatment") needs most of its words to match; a long one needs a couple.
export function suggestRows(finding, rows, limit = 3) {
  const f = finding || {};
  const have = tokenise([f.title, f.issueTitle, f.location, f.works, f.defect].filter(Boolean).join(" "));
  if (!have.size) return [];
  const scored = [];
  for (const r of rows || []) {
    if (!r || r.active === false) continue;
    const rt = tokenise(`${r.work} ${r.trade || ""}`);
    if (!rt.size) continue;
    let hits = 0;
    for (const t of rt) if (have.has(t)) hits += 1;
    if (!hits) continue;
    const share = hits / rt.size;
    if (hits >= 2 || share >= 0.5) scored.push({ row: r, score: hits + share });
  }
  scored.sort((a, b) => b.score - a.score || String(b.row.createdAt || "").localeCompare(String(a.row.createdAt || "")));
  return scored.slice(0, limit).map((x) => x.row);
}
