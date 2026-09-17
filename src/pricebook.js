// The phone's side of the surveyor's own rates — kept on the phone, sent
// with each drafting request, where the server cleans them exactly as it
// would a saved row.
import { loadPriceRows, savePriceRows } from "./storage.js";
import { normaliseRow, suggestRows } from "../shared/pricebook.js";

export { suggestRows };

export async function listRates() {
  return (await loadPriceRows()).filter((r) => r.active !== false);
}

export async function addRate(input) {
  const n = normaliseRow({ ...input, id: undefined });
  if (!n.ok) throw new Error(n.error);
  const rows = await loadPriceRows();
  await savePriceRows([n.row, ...rows]);
  return n.row;
}

export async function removeRate(id) {
  const rows = await loadPriceRows();
  await savePriceRows(rows.map((r) => (r.id === id ? { ...r, active: false } : r)));
}

// what the finding's cost basis says when a saved rate is applied
export const rateBasis = (row) => `Your rate ${row.id}: ${row.work}${row.trade ? ` (${row.trade})` : ""}`;
