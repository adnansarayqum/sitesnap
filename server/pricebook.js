// The firm's own rates, stored per organisation and merged into the
// reference pack at request time. The merged pack is hashed like the file
// pack, so a run records exactly which firm rows it could pick from, and an
// approved finding that cited a rate goes back to review if that rate
// changes. In local mode the phone keeps the rows and sends them with the
// request; they are cleaned here exactly as a DB row would be.
import { q, one } from "./db.js";
import { shortHash } from "./reference.js";
import { normaliseRow, toPriceBookRow } from "../shared/pricebook.js";

export function cleanFirmRows(list) {
  return (Array.isArray(list) ? list : []).slice(0, 200).map((r) => normaliseRow(r)).filter((x) => x.ok).map((x) => x.row).filter((r) => r.active !== false);
}

const fromDb = (r) => ({
  id: r.id, work: r.work, trade: r.trade, unit: r.unit, low: r.low, high: r.high, notes: r.notes, active: r.active,
  sourceCaseId: r.source_case_id, sourceFindingId: r.source_finding_id, sourceTitle: r.source_title,
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, uses: r.uses,
});

export async function loadFirmRows(orgId, { includeInactive = false } = {}) {
  const rows = (await q(`select * from price_rows where org_id = $1${includeInactive ? "" : " and active"} order by created_at desc limit 500`, [orgId])).rows;
  return rows.map(fromDb);
}

export async function insertFirmRow(orgId, userId, row) {
  const r = await one(
    `insert into price_rows (id, org_id, work, trade, unit, low, high, notes, active, source_case_id, source_finding_id, source_title, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
    [row.id, orgId, row.work, row.trade, row.unit, row.low, row.high, row.notes, row.active !== false, row.sourceCaseId, row.sourceFindingId, row.sourceTitle, userId],
  );
  return fromDb(r);
}

// the whole row is re-validated after the patch, so a range can never be
// left reversed or a description emptied
export async function updateFirmRow(orgId, id, patch) {
  const cur = await one("select * from price_rows where id = $1 and org_id = $2", [id, orgId]);
  if (!cur) return null;
  const n = normaliseRow({ ...fromDb(cur), ...patch, id });
  if (!n.ok) { const e = new Error(n.error); e.status = 400; e.code = "bad_row"; throw e; }
  const row = n.row;
  const r = await one(
    `update price_rows set work = $3, trade = $4, unit = $5, low = $6, high = $7, notes = $8, active = $9, updated_at = now() where id = $1 and org_id = $2 returning *`,
    [id, orgId, row.work, row.trade, row.unit, row.low, row.high, row.notes, row.active],
  );
  return fromDb(r);
}

export function mergeReference(ref, firmRows) {
  const active = (firmRows || []).filter((r) => r && r.active !== false);
  if (!active.length) return ref;
  const extra = active.map((r) => { const row = toPriceBookRow(r); return { ...row, hash: shortHash(row) }; });
  const rows = [...ref.priceBook.rows.filter((r) => !extra.some((x) => x.id === r.id)), ...extra];
  return {
    ...ref,
    hashes: { ...ref.hashes, priceBook: shortHash([ref.hashes.priceBook, extra.map((r) => r.hash)]) },
    versions: { ...ref.versions, priceBook: `${ref.versions.priceBook}+${extra.length} firm` },
    label: `${ref.label} · ${extra.length} firm rate${extra.length === 1 ? "" : "s"}`,
    priceBook: { ...ref.priceBook, rows, byId: Object.fromEntries(rows.map((r) => [r.id, r])) },
  };
}
