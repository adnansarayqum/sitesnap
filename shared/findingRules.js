// Rules both sides of the wire enforce identically. The phone uses them so
// the screen never shows a button the server would refuse; the server is the
// authority — a request that breaks them is rejected there whatever the
// screen said. Plain JS, no imports, so Vite and Node both load it as is.

// ---- finding status machine ------------------------------------------------
export const FINDING_STATUSES = ["draft", "review_required", "edited", "approved", "rejected", "superseded"];

// who may move a finding where. `superseded` is set by the system when a
// newer draft replaces a finding, never by a review action.
const TRANSITIONS = {
  draft: ["edited", "approved", "rejected"],
  review_required: ["edited", "approved", "rejected", "draft"],
  edited: ["approved", "rejected", "draft", "edited"],
  approved: ["review_required", "rejected", "draft"],
  rejected: ["draft"],
  superseded: [],
};
export function canTransition(from, to) {
  return !!(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

// the one rule the report, the workbook and the webhook payload all obey:
// approved, and not a mock (mock findings exist so developers can exercise
// the review screen without a provider key; they are never report content)
export const isReportable = (f) => !!f && f.status === "approved" && !f.mock;

// the gate the pipeline's verifier set: approval is only ever possible when
// nothing is blocking and the analysis is not stale against the evidence
export function approvalBlockers(f, currentFingerprint) {
  const reasons = [];
  if (!f) return ["no finding"];
  if (f.status === "superseded") reasons.push("superseded by a newer draft");
  const gate = f.gate || {};
  if (gate.status === "blocked") reasons.push(...(gate.reasons && gate.reasons.length ? gate.reasons : ["verification found an unsupported claim"]));
  if (gate.status === "incomplete_evidence") reasons.push(...(gate.reasons && gate.reasons.length ? gate.reasons : ["material evidence was not available to the analysis"]));
  if (currentFingerprint && f.evidenceFingerprint && f.evidenceFingerprint !== currentFingerprint) reasons.push("inspection evidence changed since this draft was generated");
  return reasons;
}

// ---- review flags: typed, with a severity the UI can sort by ---------------
export const FLAGS = {
  unsupported_claim:      { severity: "blocking",      label: "Unsupported claim" },
  contradictory_evidence: { severity: "blocking",      label: "Evidence contradicts the draft" },
  incomplete_evidence:    { severity: "blocking",      label: "Evidence incomplete" },
  stale_analysis:         { severity: "blocking",      label: "Evidence changed since drafting" },
  unconfirmed_association:{ severity: "warning",       label: "Evidence link not confirmed" },
  disagreement:           { severity: "warning",       label: "Photos disagree with your read" },
  unpriced:               { severity: "warning",       label: "Unpriced — check" },
  quantity_unconfirmed:   { severity: "warning",       label: "Quantity to confirm" },
  price_assumption:       { severity: "warning",       label: "Priced on an assumption" },
  scope_uncertain:        { severity: "warning",       label: "Scope uncertain" },
  no_photo_evidence:      { severity: "warning",       label: "No photo shows it" },
  legal_check:            { severity: "warning",       label: "Legal check" },
  asbestos:               { severity: "warning",       label: "Asbestos" },
  low_confidence:         { severity: "warning",       label: "Low confidence" },
  partial_visual_review:  { severity: "informational", label: "Not every photo was shown to the cause analysis" },
  style:                  { severity: "informational", label: "Wording" },
};
export const flagSeverity = (flag) => (FLAGS[flag] ? FLAGS[flag].severity : "warning");
export const flagLabel = (flag) => (FLAGS[flag] ? FLAGS[flag].label : String(flag).replace(/_/g, " "));
const RANK = { blocking: 0, warning: 1, informational: 2 };
export const sortFlags = (flags) => [...new Set(flags || [])].sort((a, b) => RANK[flagSeverity(a)] - RANK[flagSeverity(b)]);
export const hasBlockingFlag = (flags) => (flags || []).some((f) => flagSeverity(f) === "blocking");

// a finding needs the surveyor's eye before approval when anything above
// informational is raised, or the model disagreed with them
export function needsAttention(f) {
  if (!f) return false;
  if ((f.review_flags || []).some((x) => flagSeverity(x) !== "informational")) return true;
  const a = f.assessment || {};
  return a.agreement === "disagree" || a.agreement === "uncertain";
}
