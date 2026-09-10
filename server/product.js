// Pilot instrumentation: product events, structured feedback and the
// founder's pilot view. Deliberately small — what happened, to whom, when —
// with nothing of the inspection itself. Accounts mode only (it needs a
// user and a firm to attach to); in local mode events are acknowledged and
// dropped, feedback is logged.
import express from "express";
import { hasDb, q } from "./db.js";
import { requireOrg, requireAdmin, rateLimit } from "./auth.js";
import { event } from "./ai/events.js";

const EVENT_NAMES = new Set([
  "case_created", "inspection_started", "issue_created", "photo_captured", "memo_recorded", "reading_added", "inspection_completed",
  "draft_requested", "finding_generated", "finding_approved", "finding_edited", "finding_rejected", "finding_regenerated",
  "report_generated", "export_zip", "export_cloud",
  "caption_requested", "caption_kept", "caption_edited", "ai_note_used", "ai_note_dismissed",
  "feedback_sent", "app_opened",
]);
const FEEDBACK_KINDS = new Set(["slowed_me_down", "saved_time", "wrong_finding", "wrong_evidence", "wrong_price", "wrong_cause", "bad_wording", "missing_feature", "other"]);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const s = (v, n) => String(v == null ? "" : v).slice(0, n);

export function mountProduct(app) {
  app.post("/api/events", hasDb ? requireOrg : (req, res, next) => next(), express.json({ limit: "256kb" }), wrap(async (req, res) => {
    const list = (Array.isArray(req.body && req.body.events) ? req.body.events : []).slice(0, 100)
      .filter((e) => e && EVENT_NAMES.has(e.name))
      .map((e) => ({ name: e.name, at: Number.isFinite(e.at) ? new Date(e.at) : new Date(), props: e.props && typeof e.props === "object" ? JSON.parse(JSON.stringify(e.props).slice(0, 2000)) : {} }));
    if (!hasDb || !list.length) return res.json({ ok: true, stored: 0 });
    if (!rateLimit(`events:${req.session.user_id}`, 600, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
    await q(`insert into product_events (org_id, user_id, name, at, props) select $1, $2, * from unnest($3::text[], $4::timestamptz[], $5::jsonb[])`,
      [req.session.org_id, req.session.user_id, list.map((e) => e.name), list.map((e) => e.at), list.map((e) => JSON.stringify(e.props))]);
    res.json({ ok: true, stored: list.length });
  }));

  app.post("/api/feedback", hasDb ? requireOrg : (req, res, next) => next(), express.json({ limit: "64kb" }), wrap(async (req, res) => {
    const b = req.body || {};
    const kind = FEEDBACK_KINDS.has(b.kind) ? b.kind : "other";
    const text = s(b.text, 2000);
    event("feedback_received", { kind, screen: s(b.screen, 60), case: s(b.caseId, 80), finding: s(b.findingId, 80), version: s(b.version, 20), chars: text.length });
    if (!hasDb) return res.json({ ok: true, stored: false });
    await q("insert into feedback (org_id, user_id, kind, text, screen, case_id, finding_id, app_version) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [req.session.org_id, req.session.user_id, kind, text, s(b.screen, 60) || null, s(b.caseId, 80) || null, s(b.findingId, 80) || null, s(b.version, 20) || null]);
    res.json({ ok: true, stored: true });
  }));

  if (!hasDb) return;

  // the founder's pilot view: per member, did they get to each milestone,
  // and when were they last here — counts and dates, no content
  app.get("/api/admin/pilot", requireAdmin, wrap(async (req, res) => {
    const rows = (await q(`
      with ev as (select user_id, name, at, props from product_events where org_id = $1)
      select u.id, coalesce(u.name, u.email) as name, u.email, m.role, u.created_at as joined_at, u.last_seen_at,
             (select min(at) from ev where ev.user_id = u.id and name = 'case_created') as first_case_at,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'case_created') as cases,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'inspection_completed') as inspections_completed,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'issue_created') as issues,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'photo_captured') as photos,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'memo_recorded') as memos,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'finding_generated') as findings_drafted,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'finding_approved') as findings_approved,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'finding_edited') as findings_edited,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'finding_rejected') as findings_rejected,
             (select count(*)::int from ev where ev.user_id = u.id and name = 'report_generated') as reports,
             (select max(at) from ev where ev.user_id = u.id) as last_event_at,
             (select count(distinct date_trunc('week', at))::int from ev where ev.user_id = u.id and name in ('photo_captured', 'inspection_completed', 'report_generated')) as active_weeks,
             (select count(*)::int from feedback f where f.user_id = u.id) as feedback
      from memberships m join users u on u.id = m.user_id where m.org_id = $1 order by u.created_at`, [req.session.org_id])).rows;
    const feedback = (await q("select f.id, f.kind, f.text, f.screen, f.case_id, f.finding_id, f.app_version, f.created_at, coalesce(u.name, u.email) as who from feedback f left join users u on u.id = f.user_id where f.org_id = $1 order by f.created_at desc limit 50", [req.session.org_id])).rows;
    res.json({ members: rows, feedback });
  }));
}
