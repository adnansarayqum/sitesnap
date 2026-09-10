// Product telemetry for the pilot: what a surveyor did and when, never what
// they captured. Events carry ids and counts only (no addresses, notes,
// captions, transcripts or photos) and are batched to POST /api/events in
// accounts mode. In local mode nothing leaves the phone — the events are
// counted in memory so the same code path works in both.
//
//   activation: case_created, inspection_started, issue_created, photo_captured,
//               memo_recorded, reading_added, inspection_completed
//   findings:   draft_requested, finding_generated, finding_approved, finding_edited,
//               finding_rejected, finding_regenerated
//   output:     report_generated, export_zip, export_cloud
//   ai:         caption_requested, caption_kept, caption_edited, ai_note_used, ai_note_dismissed
//   product:    feedback_sent
export const APP_VERSION = "2.1.0";

let enabled = false;
let queue = [];
let timer = null;
const local = { counts: {} };

export function configureTelemetry({ on }) { enabled = !!on; }

const PROP_ALLOW = new Set(["case", "room", "issue", "finding", "count", "photos", "memos", "readings", "rooms", "issues", "gate", "agreement", "flags", "status", "durationMs", "sinceStartMs", "kind", "screen", "version", "reused", "mode"]);

export function track(name, props = {}) {
  const safe = { v: APP_VERSION };
  for (const [k, v] of Object.entries(props)) {
    if (!PROP_ALLOW.has(k) || v === undefined || v === null) continue;
    safe[k] = Array.isArray(v) ? v.slice(0, 12).map(String) : typeof v === "string" ? v.slice(0, 80) : v;
  }
  local.counts[name] = (local.counts[name] || 0) + 1;
  if (!enabled) return;
  queue.push({ name, at: Date.now(), props: safe });
  if (queue.length >= 20) flushTelemetry();
  else if (!timer) timer = setTimeout(flushTelemetry, 4000);
}

export function flushTelemetry() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!enabled || !queue.length) return;
  const batch = queue;
  queue = [];
  try {
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }), keepalive: true })
      .catch(() => { queue = [...batch, ...queue].slice(-200); });
  } catch { queue = [...batch, ...queue].slice(-200); }
}

export const localTelemetry = () => ({ ...local.counts });

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushTelemetry);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushTelemetry(); });
}

// Structured feedback from a surveyor, with just enough context to act on
// it: the screen, the case and finding ids, the app version. No evidence.
export const FEEDBACK_KINDS = [
  ["slowed_me_down", "This slowed me down"], ["saved_time", "This saved me time"], ["wrong_finding", "This finding is wrong"],
  ["wrong_evidence", "Wrong evidence linked"], ["wrong_price", "Wrong price"], ["wrong_cause", "Wrong cause"],
  ["bad_wording", "Wording needs work"], ["missing_feature", "Something's missing"], ["other", "Something else"],
];
export async function sendFeedback({ kind, text, screen, caseId, findingId }) {
  track("feedback_sent", { kind, screen });
  const body = { kind, text: String(text || "").slice(0, 2000), screen, caseId: caseId || null, findingId: findingId || null, version: APP_VERSION };
  const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Couldn't send that — try again when you're back on signal.");
  return r.json();
}
