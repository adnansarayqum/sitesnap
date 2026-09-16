// Turns SiteSnap's per-issue findings into the one-row-per-room shape the
// MLA (and, later, TLB) Scott Schedule expects — matching Shah's own rule
// that a room's issues stay together in one row, never split out.
import { approvedByRoom } from "../findings.js";

// The firm always cites in this order (S9A S10 S11 ... LTA, then DPA last)
// regardless of which finding happened to be approved first.
const CITE_ORDER = ["S9A", "S10", "S11", "S4 DPA"];

function breachFor(findings) {
  const cites = [...new Set(findings.flatMap((f) => f.legislation || []))]
    .map((c) => c.replace(/\s*LTA\s*$/, "").replace(/\s*DPA.*$/, "S4 DPA").trim());
  cites.sort((a, b) => (CITE_ORDER.indexOf(a) === -1 ? 99 : CITE_ORDER.indexOf(a)) - (CITE_ORDER.indexOf(b) === -1 ? 99 : CITE_ORDER.indexOf(b)));
  // "S9A S10 S11 LTA" not "S9A LTA S10 LTA S11 LTA" — the firm writes one
  // trailing "LTA" for the whole citation group, matching the legal
  // register's own citation forms (each already ends "LTA"). DPA 1972
  // stands alone (it isn't an LTA section) so it isn't folded into that suffix.
  const ltaCites = cites.filter((c) => c !== "S4 DPA");
  const legislation = [ltaCites.length ? `${ltaCites.join(" ")} LTA` : "", cites.includes("S4 DPA") ? "S4 DPA 1972" : ""].filter(Boolean).join(" ");
  const byCat = { "Cat 1": [], "Cat 2": [] };
  for (const f of findings) {
    const m = f.hhsrs_hazard && f.hhsrs_hazard.match(/^(Cat \d) Risk Hazard (\d+)$/);
    if (m && byCat[m[1]]) byCat[m[1]].push(m[2]);
  }
  const cat = byCat["Cat 1"].length ? "Cat 1" : byCat["Cat 2"].length ? "Cat 2" : null;
  if (!cat) return legislation;
  const nums = [...new Set(byCat[cat])];
  const hazardWord = nums.length > 1 ? "Risk Hazards" : "Risk Hazard";
  const list = nums.length > 2 ? `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}` : nums.join(" and ");
  return `${legislation} - ${cat}, ${hazardWord} ${list}`;
}

// One row per room that has at least one approved, reportable finding —
// rooms still mid-review don't belong in an agency export yet. Returns
// both the rows and a list of things worth flagging before sending (a
// room with no Issue of Concern captured yet, an unpriced finding).
export function reportRows(inspection, rooms) {
  const byRoom = approvedByRoom(inspection.findings, rooms);
  const warnings = [];
  const rows = byRoom.map(({ room, roomId, findings }) => {
    const unpriced = findings.filter((f) => f.cost && f.cost.unpriced);
    const cost = findings.reduce((sum, f) => sum + (f.cost && !f.cost.unpriced ? f.cost.low : 0), 0);
    const r = (rooms || []).find((x) => x.id === roomId);
    if (!r || !r.issueOfConcern) warnings.push(`${room}: no Issue of Concern captured yet — the tenant's own complaint`);
    if (unpriced.length) warnings.push(`${room}: ${unpriced.length} finding${unpriced.length === 1 ? "" : "s"} unpriced — cost total is incomplete`);
    return {
      room, issueOfConcern: (r && r.issueOfConcern) || "",
      siteFindings: findings.map((f) => f.defect).filter(Boolean).join(" "),
      causation: findings.map((f) => f.cause_text).filter(Boolean).join(" "),
      remedialWorks: findings.map((f) => f.remedial.works).filter(Boolean).join(" "),
      cost, breach: breachFor(findings),
    };
  });
  return { rows, warnings };
}
