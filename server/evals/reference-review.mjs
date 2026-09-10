#!/usr/bin/env node
// Generates the reference-pack "break review" worksheet for a practising
// housing-disrepair expert witness from the ACTUAL current contents of
// server/reference/*. Regenerate whenever the pack changes; the worksheet
// records the versions and hashes it was built from so a completed review is
// tied to specific content.
//
//   node server/evals/reference-review.mjs            # writes docs/reference-pack-review.md
//   node server/evals/reference-review.mjs out.md
//
// Completed answers are the reviewer's professional opinion. They are input to
// a human decision about the reference files — never applied automatically.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReference, REF_DIR } from "../reference.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, "..", "..", "docs", "reference-pack-review.md");
const ref = loadReference(true);
const today = new Date().toISOString().slice(0, 10);
const L = [];
const p = (s = "") => L.push(s);
const esc = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const box = (q) => p(`- [ ] ${q}`);
const field = (label, lines = 1) => { p(`**${label}:**`); for (let i = 0; i < lines; i++) p("> "); p(""); };
const decision = () => { p("**Decision:** ☐ Keep   ☐ Modify   ☐ Remove   ☐ Needs legal / professional review"); p(""); p("**Priority if changed:** ☐ P0 (could produce materially unsafe or incorrect professional output)   ☐ P1 (likely to reduce quality or usefulness)   ☐ P2 (wording / completeness)"); p(""); };

// ---- corrections.md → numbered rules with their version ----------------------------
function parseCorrections(md) {
  const rules = [];
  let version = "";
  let cur = null;
  for (const raw of md.split("\n")) {
    const v = /^##\s*Version\s+(\d+)\s*[—-]\s*([0-9-]+)/.exec(raw);
    if (v) { version = `v${v[1]} (${v[2]})`; cur = null; continue; }
    const m = /^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)$/.exec(raw);
    if (m) { cur = { n: Number(m[1]), title: m[2], text: m[3].trim(), version }; rules.push(cur); continue; }
    if (cur && /^\s{3,}\S/.test(raw)) cur.text += " " + raw.trim();
    else if (cur && raw.trim() === "") cur = null;
  }
  return rules.sort((a, b) => a.n - b.n);
}
function parsePlaybook(md) {
  const sections = [];
  let cur = null;
  for (const raw of md.split("\n")) {
    const h = /^##\s+(.+)$/.exec(raw);
    if (h) { cur = { title: h[1].trim(), body: [] }; sections.push(cur); continue; }
    if (cur) cur.body.push(raw);
  }
  return sections.map((s) => ({ ...s, body: s.body.join("\n").trim() }));
}

const corrections = parseCorrections(ref.corrections);
const playbook = parsePlaybook(ref.playbook);
const legalNotes = fs.readFileSync(path.join(REF_DIR, "legal-register.md"), "utf8");

// ---- header ----------------------------------------------------------------------------------
p(`# SiteSnap reference pack — break review`);
p();
p(`*Generated ${today} from the files below. Regenerate with \`node server/evals/reference-review.mjs\` after any change to \`server/reference/\`.*`);
p();
p(`## Purpose`);
p();
p(`This is not "please check whether this looks okay". It is: **try to break SiteSnap's professional reference material.**`);
p();
p(`SiteSnap's drafting pipeline can only cite legislation, name an HHSRS hazard or price works by selecting an entry from these files by its id. The software guarantees it cannot invent an entry. It cannot guarantee the entry is right, that it applies to the defect in front of it, or that nothing important is missing. That is what this review is for. If an entry below is wrong, too broad, or easy to misapply, the pipeline will produce a well-formed, traceable, **wrong** finding — and do so consistently.`);
p();
p(`The architecture is: *AI proposes, the system validates, the surveyor decides.* You are the authority on the content. Nothing you write here is applied automatically; see "What happens after this review" at the end.`);
p();
p(`## How to complete it`);
p();
p(`- Work through each entry. Tick the questions you have considered; write where a box does not fit.`);
p(`- For every entry record a **Decision** (Keep / Modify / Remove / Needs legal or professional review) and, if anything should change, a **Priority**.`);
p(`- Be adversarial: for each entry ask *"How would a model misuse this? What would another surveyor challenge?"* The most valuable answers are in the **"must NOT be used when"** and **"evidence required before"** fields.`);
p(`- The **Missing knowledge** section near the end may be worth more than everything above it. Please do not skip it.`);
p(`- Copy every issue you find into the **Review output** table at the end — one row per issue — so changes can be actioned.`);
p();
p(`| Reviewer | Date | Firm / role |`);
p(`|---|---|---|`);
p(`| | | |`);
p();
p(`### Content reviewed`);
p();
p(`| File | Version | Content hash |`);
p(`|---|---|---|`);
p(`| legal-register.json | ${ref.versions.legal} | \`${ref.hashes.legal}\` |`);
p(`| legal-register.md (citation guidance) | — | \`${ref.hashes.legalNotes}\` |`);
p(`| hhsrs.json | ${ref.versions.hhsrs} | \`${ref.hashes.hhsrs}\` |`);
p(`| price-book.json | ${ref.versions.priceBook} (${ref.priceBook.currency}) | \`${ref.hashes.priceBook}\` |`);
p(`| corrections.md | ${ref.versions.corrections} | \`${ref.hashes.corrections}\` |`);
p(`| playbook.md | hash ${ref.versions.playbook} | \`${ref.hashes.playbook}\` |`);
p();
p(`*If any hash differs from \`GET /api/ai/config\` on the deployment under review, the pack has changed since this worksheet was generated — regenerate it.*`);
p();

// ---- 1. legal register ------------------------------------------------------------------------------
p(`---`);
p();
p(`# 1. Legal register (${ref.legal.entries.length} entries)`);
p();
p(`The model selects an entry by id; the server inserts the **cite** text verbatim into the finding. The **applies_when** / **not_when** text is shown to the model as guidance when it chooses. Jurisdiction: England & Wales.`);
p();
p(`### Register-wide questions`);
p();
box(`Is the set of entries right for housing-disrepair expert reports? What is missing entirely? (e.g. s.4 DPA use, Environmental Protection Act 1990 s.79 statutory nuisance, Decent Homes, Awaab's Law timescales, Renters' Rights Act changes, tenancy-type exclusions)`);
box(`Are the commencement/tenancy conditions (S9A dates, s.11 seven-year rule) things the pipeline can ever know from an inspection? If not, should every citation carry a standing caveat for the legal team?`);
box(`Is the firm's cite form ("S11 LTA") exactly what your Scott Schedule uses?`);
p();
for (const e of ref.legal.entries) {
  p(`## ${e.id} — ${esc(e.cite)}`);
  p();
  p(`| | |`); p(`|---|---|`);
  p(`| Title | ${esc(e.title)} |`);
  p(`| Cite as (inserted verbatim) | **${esc(e.cite)}** |`);
  p(`| Covers | ${esc(e.covers)} |`);
  p(`| Applies when (shown to the model) | ${esc(e.applies_when)} |`);
  p(`| Not when (shown to the model) | ${esc(e.not_when)} |`);
  p(`| Entry hash | \`${e.hash}\` |`);
  p();
  box(`Is the citation / section reference accurate and current?`);
  box(`Is the canonical **cite** wording right for the Breach column? Does it need changing?`);
  box(`Is **covers** accurate? Too broad? Too narrow?`);
  box(`Is **applies_when** correct — and is it something a model can judge from inspection evidence?`);
  box(`Is **not_when** complete? What else must exclude this entry?`);
  box(`Could a model easily misuse this entry? How? (text-match on a word, similar-sounding defect, stretching to avoid an empty list)`);
  box(`Is anything important missing from this entry?`);
  p();
  field(`When must this NOT be used`, 2);
  field(`Evidence that must exist before this can reasonably be applied`, 2);
  field(`Likely misuse by a model`, 1);
  field(`Canonical wording change (if any)`, 1);
  decision();
}
p(`## Citation guidance (legal-register.md)`);
p();
p(`The prose sheet the analysis stage reads. Current rules for citing:`);
p();
for (const line of legalNotes.split("\n")) if (/^- /.test(line) && /cit|empty|notice|asbestos|condensation/i.test(line)) p(`> ${line.replace(/^- /, "")}`);
p();
box(`Is each rule above correct? Which would you reword?`);
box(`"Leave the legislation list empty rather than guess" — is an empty citation acceptable in your reports, or does it need a standing phrase?`);
box(`The standard of proof and phrasing rules ("on the balance of probabilities", "at the time of inspection", "consistent with") — anything missing or wrong?`);
p();
field(`Changes`, 3);
decision();

// ---- 2. HHSRS --------------------------------------------------------------------------------------------
p(`---`);
p();
p(`# 2. HHSRS hazards (${ref.hhsrs.hazards.length})`);
p();
p(`The model may select a hazard only by id, and only where the evidence "clearly engages it"; the server writes the firm's form ("Cat 2 Risk Hazard 1"). Any hazard proposed at less than high confidence is marked *review required* for the surveyor. The playbook currently steers the model towards Hazards 1, 4 and 29; the rest are available but unguided.`);
p();
p(`### Hazard-list-wide questions`);
p();
box(`Should SiteSnap **ever** propose Category 1? A Cat 1 / Cat 2 call is a scored HHSRS judgement. Options: (a) allow both, marked for review; (b) Cat 2 only, surveyor upgrades; (c) hazard only, no category. Which?`);
box(`Which hazards should the software **never** propose automatically (e.g. 6 CO, 23 electrical, 24 fire, 27 explosions — outside a visual damp/disrepair inspection)?`);
box(`Which hazards are most often over-classified in disrepair reports, in your experience?`);
box(`When should SiteSnap return **no hazard** even though a defect is real?`);
p();
field(`Answers`, 4);
p(`### Per-hazard review`);
p();
p(`For the hazards the pipeline is guided towards (1, 4, 29), please complete every column. For the rest, the key question is the last column: should it be available to the software at all?`);
p();
p(`| # | Hazard | Correctly defined? | Evidence needed before proposing | Visual patterns that are NOT enough on their own | Commonly confused with | Over-classification risk | Available to software? (Y / review-only / never) |`);
p(`|---|---|---|---|---|---|---|---|`);
for (const h of ref.hhsrs.hazards) {
  const guided = [1, 4, 29].includes(h.n);
  p(`| ${h.n}${guided ? " ★" : ""} | ${esc(h.name)} | | | | | | |`);
}
p();
p(`★ = currently guided by the playbook.`);
p();
field(`Additional notes on HHSRS`, 3);
decision();

// ---- 3. price book --------------------------------------------------------------------------------------
p(`---`);
p();
p(`# 3. Price book — ${ref.priceBook.rows.length} rows, ${ref.priceBook.currency}, ${ref.versions.priceBook}`);
p();
p(`The model selects a row by id and proposes a quantity with the evidence for it; the **server** multiplies and stores the book version. The model never writes a number. So the failure mode is not arithmetic — it is a **valid row id applied to the wrong professional situation**, a wrong unit, a missing preparatory item, or a stale rate. Rows marked *example* are placeholders awaiting the firm's rates; rows marked *confirmed* came from the surveyor.`);
p();
p(`Ranges are stated as supply-and-fit, including access and making good, excluding VAT unless a row says otherwise.`);
p();
p(`### Book-wide questions`);
p();
box(`Are the ranges in the right order of magnitude for your region and for contested disrepair claims (as opposed to a private quote)?`);
box(`What common remedial items are missing entirely? (flooring, windows, doors, render, roofing, electrics, heating, damp-proofing, ventilation other than a fan, decoration after damp…)`);
box(`Should every *example* row be **blocked from automatic selection** until confirmed?`);
box(`Is "per room ceiling (up to ~14 m²)" a safe unit, or should ceilings be per m²?`);
box(`Is there a minimum-charge rule (call-out) that should apply across rows?`);
p();
field(`Answers`, 4);
for (const r of ref.priceBook.rows) {
  p(`## ${r.id} — ${r.status || "unstated"}${r.active ? "" : " (INACTIVE)"}`);
  p();
  p(`| | |`); p(`|---|---|`);
  p(`| Work (shown to the model) | ${esc(r.work)} |`);
  p(`| Unit | ${esc(r.unit)} |`);
  p(`| Range | £${r.low} – £${r.high} |`);
  p(`| Quantity model | kind **${r.qty ? r.qty.kind : "count"}**, unit ${esc(r.qty ? r.qty.unit : r.unit)}, default ${r.qty && r.qty.default != null ? r.qty.default : "none"}, evidence **${r.qty ? r.qty.evidence : "assumable"}** |`);
  p(`| Mutually exclusive with | ${(r.excludes || []).join(", ") || "—"} |`);
  p(`| Notes (shown to the model) | ${esc(r.notes) || "—"} |`);
  p(`| Source | ${esc(r.source) || "—"} |`);
  p(`| Row hash | \`${r.hash}\` |`);
  p();
  box(`**Description** — accurate, complete, unambiguous? Could it be text-matched to a defect it does not fit?`);
  box(`**Unit** — right unit? (count vs m² vs m; "area up to ~X m²" safe?)`);
  box(`**Low / high** — defensible in a contested claim? Stale?`);
  box(`**Scope** — localised vs whole-element applicability clear?`);
  box(`**Inclusions / exclusions** — what does the range include (access, disposal, making good, decoration)? What must be priced separately?`);
  box(`**Preparatory / dependent works** — what must accompany this row (e.g. cause before finish; sampling before disturbance)?`);
  box(`**Minimum charge** — is the low figure a true floor?`);
  box(`**Quantity basis** — is "${r.qty ? r.qty.evidence : "assumable"}" right? Should the default (${r.qty && r.qty.default != null ? r.qty.default : "none"}) exist at all?`);
  box(`**Overlaps** — other rows this should exclude or be excluded by?`);
  p();
  field(`Could this row be technically text-matched but professionally wrong? When?`, 2);
  field(`Evidence that must exist before this row may be used`, 2);
  p(`**Selection control:** ☐ may be selected automatically   ☐ requires quantity confirmation   ☐ requires professional review before use   ☐ never select automatically`);
  p();
  decision();
}

// ---- 4. corrections ------------------------------------------------------------------------------------------
p(`---`);
p();
p(`# 4. Corrections list (${corrections.length} rules, ${ref.versions.corrections})`);
p();
p(`Every rule is read by the reasoning stages on every request as a **binding** instruction. Each was written from a mistake a draft made. The danger of such a list is that it becomes an accumulation of absolute rules created from isolated incidents; a rule that is right in one context can create the opposite error in another.`);
p();
for (const r of corrections) {
  p(`## Rule ${r.n} — ${esc(r.title)} *(${r.version})*`);
  p();
  p(`> ${esc(r.text)}`);
  p();
  box(`Is this rule always valid?`);
  box(`Are there exceptions? Which defects, materials or contexts?`);
  box(`Could following it blindly create a different error?`);
  box(`Should it apply globally, or only to a specific defect / material / context?`);
  box(`Does it conflict with another rule or with the playbook?`);
  box(`Can it be stated more precisely?`);
  p();
  field(`Exceptions / narrower scope / better wording`, 2);
  decision();
}

// ---- 5. playbook -------------------------------------------------------------------------------------------------
p(`---`);
p();
p(`# 5. Defect playbook (${playbook.length} sections)`);
p();
p(`Professional reasoning guidance the causation and analysis stages read. It is "the firm's accumulated judgement", not a script. It is the most influential text in the pack for *which cause* the model prefers.`);
p();
for (const s of playbook) {
  p(`## ${esc(s.title)}`);
  p();
  for (const line of s.body.split("\n")) p(line ? `> ${line}` : ">");
  p();
  box(`Is the guidance correct? What would you change?`);
  box(`Which distinctions are missing (causes, patterns, readings, tests)?`);
  box(`Where should the model be **more conservative** than this text allows?`);
  box(`Are the rows and citations this section points to the right ones?`);
  p();
  field(`Changes`, 3);
  decision();
}

// ---- 6. missing knowledge --------------------------------------------------------------------------------------------
p(`---`);
p();
p(`# 6. Missing knowledge`);
p();
p(`This section may be worth more than every row above. Please answer from your own casework, not from what the pack already contains.`);
p();
for (const q of [
  "Which common housing-disrepair situations are missing from the pack entirely?",
  "Which defect types will SiteSnap encounter most often in your instructions? Are they covered?",
  "Which professional distinctions are currently absent (e.g. interstitial vs surface condensation; hygroscopic salts vs live damp; thermal bridging; defective DPC vs bridged DPC; historic vs live movement; tenant-caused vs landlord-liable)?",
  "Which pricing scenarios are missing (trades, preparatory works, access, specialist contractors, making good, decoration after works, minimum charges)?",
  "Which legal / HHSRS contexts are missing (statutes, protocol points, hazard types, tenancy-type limits)?",
  "Which findings regularly require **further investigation** before an opinion can be given — and should therefore never be drafted as a settled cause?",
  "Which conclusions would you **never** want software to make automatically, even as a draft for your review?",
  "What do defendants' experts most often attack in a claimant report — and would this pack make those attacks easier or harder?",
]) { p(`### ${q}`); p(); for (let i = 0; i < 4; i++) p("> "); p(); }

// ---- 7. review output table ----------------------------------------------------------------------------------------
p(`---`);
p();
p(`# 7. Review output — one row per issue`);
p();
p(`Copy every problem found above into this table. This is the list the changes are actioned from.`);
p();
p(`| Reference ID | Current content (short) | Problem | Risk if unchanged | Recommended change | Professional rationale | Priority (P0/P1/P2) | Reviewer | Date |`);
p(`|---|---|---|---|---|---|---|---|---|`);
for (let i = 0; i < 20; i++) p(`| | | | | | | | | |`);
p();
p(`**P0** — could produce materially unsafe or incorrect professional output · **P1** — likely to reduce quality or usefulness · **P2** — wording / completeness.`);
p();

// ---- governance --------------------------------------------------------------------------------------------------------
p(`---`);
p();
p(`# What happens after this review`);
p();
p(`Your answers are professional opinion and are treated as the authority on content. They are **not** applied automatically and the software never changes reference content from a model's inference.`);
p();
p(`1. A human decides which changes to make, from the output table.`);
p(`2. The reference files are edited intentionally (\`server/reference/*.json\`, \`corrections.md\`, \`playbook.md\`, \`legal-register.md\`). Corrections are appended under a new version; entries are never silently re-meant.`);
p(`3. File versions are bumped; content hashes change automatically. Every previously approved finding that cited a changed entry is put back in front of its surveyor for review.`);
p(`4. The golden evaluation suite is re-run on both splits (\`node server/evals/run.mjs\` and \`--holdout\`) with the real model.`);
p(`5. Regressions are assessed before the change is deployed. If a change fixes one case and breaks another, the reviewer is asked again.`);
p();
p(`This worksheet is regenerated from the new content and the cycle repeats.`);
p();

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, L.join("\n"));
console.log(`wrote ${path.relative(process.cwd(), out)} — ${ref.legal.entries.length} legal entries, ${ref.hhsrs.hazards.length} hazards, ${ref.priceBook.rows.length} price rows, ${corrections.length} correction rules, ${playbook.length} playbook sections`);
