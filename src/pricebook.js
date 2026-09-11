// The phone's side of the surveyor's own rates. Accounts mode: the firm's
// register holds them (shared across the firm's devices). Local mode: this
// phone holds them and sends them with each drafting request, where the
// server cleans them exactly as it would a register row.
import { loadPriceRows, savePriceRows } from "./storage.js";
import { normaliseRow, suggestRows } from "../shared/pricebook.js";

export { suggestRows };

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error(data.message || (data.error === "sign_in" ? "You've been signed out — sign in again." : data.error) || `Request failed (${r.status})`);
  return data;
}

export async function listRates(accounts) {
  if (accounts) {
    try { const r = await fetch("/api/price-book", { cache: "no-store" }); if (!r.ok) return []; return (await r.json()).rows || []; }
    catch { return []; }
  }
  return (await loadPriceRows()).filter((r) => r.active !== false);
}

export async function addRate(accounts, input) {
  const n = normaliseRow({ ...input, id: undefined });
  if (!n.ok) throw new Error(n.error);
  if (accounts) return (await call("POST", "/api/price-book/rows", n.row)).row;
  const rows = await loadPriceRows();
  await savePriceRows([n.row, ...rows]);
  return n.row;
}

export async function removeRate(accounts, id) {
  if (accounts) { await call("PATCH", `/api/price-book/rows/${encodeURIComponent(id)}`, { active: false }); return; }
  const rows = await loadPriceRows();
  await savePriceRows(rows.map((r) => (r.id === id ? { ...r, active: false } : r)));
}

// what the finding's cost basis says when a saved rate is applied
export const rateBasis = (row) => `Your rate ${row.id}: ${row.work}${row.trade ? ` (${row.trade})` : ""}`;
