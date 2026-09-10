// The firm's reference pack as typed services, not one concatenated prompt.
//
//   legal      controlled lookup: the model picks an id, the server writes the citation
//   hhsrs      controlled lookup: hazard ids -> the firm's schedule form
//   priceBook  controlled pricing: the model picks rows + quantities, the server does the arithmetic
//   playbook   professional reasoning guidance (prompt text for the analysis stages)
//   corrections binding rules, versioned (prompt text for the analysis stages)
//   style      register and wording (prompt text for the drafting stage ONLY — never evidence)
//
// Every part carries a version and a content hash so a run can record exactly
// what it was judged against, and so a later change to a price row or a legal
// entry can put an approved finding back in front of the surveyor.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REF_DIR = path.join(__dirname, "reference");

export const sha = (s) => crypto.createHash("sha256").update(typeof s === "string" ? s : JSON.stringify(s)).digest("hex");
export const shortHash = (s) => sha(s).slice(0, 12);

const read = (f) => { try { return fs.readFileSync(path.join(REF_DIR, f), "utf8"); } catch { return ""; } };
const readJson = (f, fallback) => { try { return JSON.parse(read(f)); } catch { return fallback; } };

let cache = null;
export function loadReference(force = false) {
  if (cache && !force) return cache;
  const legalRaw = readJson("legal-register.json", { version: 0, entries: [] });
  const hhsrsRaw = readJson("hhsrs.json", { version: 0, hazards: [] });
  const priceRaw = readJson("price-book.json", { version: 0, items: [] });
  const legalNotes = read("legal-register.md");
  const playbook = read("playbook.md");
  const corrections = read("corrections.md");
  const style = read("style-examples.md");
  const m = /##\s*Version\s+(\d+)\s*[—-]\s*([0-9-]+)/.exec(corrections);

  const legalEntries = (legalRaw.entries || []).map((e) => ({ ...e, hash: shortHash(e) }));
  const hazards = (hhsrsRaw.hazards || []).map((h) => ({ ...h, hash: shortHash(h) }));
  const rows = (priceRaw.items || []).map((r) => ({ ...r, active: r.active !== false, hash: shortHash(r) }));

  cache = {
    versions: {
      legal: `v${legalRaw.version || 0}`,
      hhsrs: `v${hhsrsRaw.version || 0}`,
      priceBook: `v${priceRaw.version || 0}`,
      corrections: m ? `v${m[1]} (${m[2]})` : "unversioned",
      playbook: shortHash(playbook),
      style: shortHash(style),
    },
    hashes: {
      legal: shortHash(legalRaw), hhsrs: shortHash(hhsrsRaw), priceBook: shortHash(priceRaw),
      corrections: shortHash(corrections), playbook: shortHash(playbook), style: shortHash(style), legalNotes: shortHash(legalNotes),
    },
    // what the app shows beside a run
    label: `corrections ${m ? `v${m[1]}` : "?"} · price book v${priceRaw.version || "?"} · legal v${legalRaw.version || "?"}`,
    legal: { version: legalRaw.version || 0, entries: legalEntries, byId: Object.fromEntries(legalEntries.map((e) => [e.id, e])), notes: legalNotes },
    hhsrs: { version: hhsrsRaw.version || 0, hazards, byId: Object.fromEntries(hazards.map((h) => [h.id, h])) },
    priceBook: { version: priceRaw.version || 0, currency: priceRaw.currency || "GBP", rows, byId: Object.fromEntries(rows.map((r) => [r.id, r])) },
    playbook, corrections, style,
  };
  return cache;
}

// ---- legal: controlled lookup ------------------------------------------------
// Resolves the model's proposed ids to canonical citations. Anything not in
// the register is rejected and reported — never passed through.
export function resolveLegal(ref, proposed) {
  const out = { refs: [], rejected: [] };
  const seen = new Set();
  for (const p of proposed || []) {
    const id = p && typeof p === "object" ? String(p.legal_register_id || p.id || "") : String(p || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const e = ref.legal.byId[id];
    if (!e) { out.rejected.push({ id, reason: "unknown legal register id" }); continue; }
    out.refs.push({ id: e.id, cite: e.cite, title: e.title, hash: e.hash, reason: String((p && p.reason) || "").slice(0, 600) });
  }
  return out;
}

export function resolveHazard(ref, proposed) {
  if (!proposed || !proposed.hazard_id) return { hazard: null, rejected: null };
  const h = ref.hhsrs.byId[String(proposed.hazard_id)];
  if (!h) return { hazard: null, rejected: { id: String(proposed.hazard_id), reason: "unknown HHSRS hazard id" } };
  const cat = proposed.category === "Cat 1" ? "Cat 1" : "Cat 2";
  return {
    hazard: {
      id: h.id, n: h.n, name: h.name, category: cat, hash: h.hash,
      // the firm's schedule form
      label: `${cat} Risk Hazard ${h.n}`,
      evidence_basis: String(proposed.evidence_basis || "").slice(0, 600),
      confidence: ["high", "medium", "low"].includes(proposed.confidence) ? proposed.confidence : "low",
      review_required: proposed.confidence !== "high",
    },
    rejected: null,
  };
}

// ---- price book: the server owns the numbers --------------------------------
// `items` is what the model proposed: [{ price_book_row_id, quantity, unit,
// quantity_basis: observed|stated|assumed|unknown, quantity_evidence: [ids], reason }]
// `overrides` is what the surveyor has confirmed or entered: { [rowId]: quantity }
//
// Returns a fully deterministic cost: per-line arithmetic, the book version,
// and exactly why a line (or the whole finding) is unpriced.
export function priceItems(ref, items, overrides = {}) {
  const book = ref.priceBook;
  const lines = [];
  const problems = [];
  const flags = new Set();
  const seenRows = new Map();
  for (const raw of items || []) {
    const rowId = String((raw && raw.price_book_row_id) || (raw && raw.row_id) || (raw && raw.id) || "");
    const row = book.byId[rowId];
    if (!row) { problems.push({ row_id: rowId, problem: "unknown_row", detail: "not in the price book" }); flags.add("unpriced"); continue; }
    if (!row.active) { problems.push({ row_id: rowId, problem: "inactive_row", detail: "row is no longer current" }); flags.add("unpriced"); continue; }
    if (seenRows.has(rowId)) { problems.push({ row_id: rowId, problem: "duplicate_row", detail: "proposed twice — quantities merged" }); seenRows.get(rowId).proposedQty += Number(raw.quantity) || 0; continue; }
    const line = {
      row_id: row.id, work: row.work, unit: row.unit, qtyKind: row.qty ? row.qty.kind : "count", qtyUnit: row.qty ? row.qty.unit : row.unit,
      proposedQty: Number(raw && raw.quantity), basis: String((raw && raw.quantity_basis) || "unknown"),
      evidence: Array.isArray(raw && raw.quantity_evidence) ? raw.quantity_evidence.map(String).slice(0, 12) : [],
      reason: String((raw && raw.reason) || "").slice(0, 400), rowHash: row.hash, rowStatus: row.status,
    };
    seenRows.set(rowId, line);
    lines.push(line);
  }
  // mutually exclusive rows (a patch and a whole-ceiling make-good in one finding)
  for (const l of lines) {
    const row = book.byId[l.row_id];
    for (const x of row.excludes || []) if (seenRows.has(x)) { problems.push({ row_id: l.row_id, problem: "overlap", detail: `cannot be priced together with ${x}` }); flags.add("unpriced"); l.overlap = x; }
  }
  let low = 0, high = 0, anyPriced = false, allPriced = true;
  for (const l of lines) {
    const row = book.byId[l.row_id];
    const q = row.qty || { kind: "count", default: 1, evidence: "assumable" };
    let qty = null, qtySource = null;
    if (Object.prototype.hasOwnProperty.call(overrides, l.row_id) && Number.isFinite(Number(overrides[l.row_id])) && Number(overrides[l.row_id]) > 0) {
      qty = Number(overrides[l.row_id]); qtySource = "surveyor";
    } else if (["observed", "stated"].includes(l.basis) && Number.isFinite(l.proposedQty) && l.proposedQty > 0 && l.evidence.length) {
      // a count the photos or the surveyor's own words support
      qty = l.proposedQty; qtySource = l.basis;
      if (q.kind === "measure") { qtySource = "stated"; flags.add("quantity_unconfirmed"); }
    } else if (q.evidence !== "required" && q.kind === "count") {
      qty = Number.isFinite(q.default) && q.default > 0 ? q.default : 1; qtySource = "assumed";
      flags.add("price_assumption"); flags.add("quantity_unconfirmed");
    }
    if (l.overlap) { l.priced = false; l.qty = null; allPriced = false; continue; }
    if (qty == null) {
      l.priced = false; l.qty = null; l.qtySource = null;
      l.problem = q.kind === "measure" ? "quantity_required" : "quantity_required";
      problems.push({ row_id: l.row_id, problem: "quantity_required", detail: `${q.unit || row.unit} quantity must be evidenced or entered by the surveyor` });
      flags.add("quantity_unconfirmed"); flags.add("unpriced");
      allPriced = false;
      continue;
    }
    l.priced = true; l.qty = qty; l.qtySource = qtySource;
    l.low = Math.round(row.low * qty); l.high = Math.round(row.high * qty);
    low += l.low; high += l.high; anyPriced = true;
  }
  const unpriced = !anyPriced || !allPriced || !lines.length;
  if (!lines.length) flags.add("unpriced");
  return {
    currency: book.currency, priceBookVersion: `v${book.version}`, priceBookHash: ref.hashes.priceBook,
    lines, problems, unpriced,
    low: unpriced ? null : low, high: unpriced ? null : high,
    partial: anyPriced && !allPriced ? { low, high } : null,
    price_book_refs: lines.filter((l) => l.priced).map((l) => l.row_id),
    flags: [...flags],
    basis: lines.filter((l) => l.priced).map((l) => `${l.row_id} × ${l.qty} ${l.qtyUnit}${l.qtySource === "assumed" ? " (assumed)" : l.qtySource === "surveyor" ? " (entered)" : ""}`).join("; ") || "No price book row could be applied",
  };
}

// the subset of reference state the app needs to detect a stale approval:
// per-entry hashes for the rows and sections a finding can cite
export function referenceFingerprints(ref) {
  return {
    label: ref.label, versions: ref.versions, hashes: ref.hashes,
    priceRows: Object.fromEntries(ref.priceBook.rows.map((r) => [r.id, r.hash])),
    legalEntries: Object.fromEntries(ref.legal.entries.map((e) => [e.id, e.hash])),
    hazards: Object.fromEntries(ref.hhsrs.hazards.map((h) => [h.id, h.hash])),
  };
}
