// HTTP surface for the AI step (see ai.js). Mounted by index.js after the
// session middleware. These routes carry photographs and audio, so they use
// their own body parsers with larger limits than the rest of /api.
//
//   GET  /api/ai/config                                   what's switched on
//   POST /api/ai/cases/:id/rooms/:roomId/transcribe        raw audio -> text
//   POST /api/ai/cases/:id/rooms/:roomId/draft             room + photos -> findings
//   GET  /api/ai/cases/:id/findings                        latest run per room
//   PUT  /api/ai/findings/:fid                             the surveyor's review
//
// In accounts mode everything is scoped to the signed-in firm and persisted
// (findings, drafting runs, transcripts) so a case's history is auditable
// and evals can compare drafts to what the surveyor approved. In local mode
// nothing is stored server-side — the phone keeps the findings in the case.
import express from "express";
import crypto from "node:crypto";
import { hasDb, q, one } from "./db.js";
import { requireOrg, rateLimit, clientIp, audit } from "./auth.js";
import { aiEnabled, transcriptionEnabled, draftRoomFindings, transcribeAudio, loadReference, AI_MODEL, AI_EFFORT } from "./ai.js";

const CASE_ID = /^insp_[\w-]{4,60}$/;
const ROOM_ID = /^room_[\w-]{4,60}$/;
const MAX_PHOTOS = 24;
const MAX_PHOTO_B64 = 3 * 1024 * 1024; // ~2.2 MB of JPEG — the AI copy is 1568px, well under
const MAX_TRANSCRIPTS = 40;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// local mode has no sessions: the app is single-user and these routes are
// as open as the rest of it
const guard = hasDb ? requireOrg : (req, res, next) => next();
const who = (req) => (req.session ? `u:${req.session.user_id}` : `ip:${clientIp(req)}`);

async function ownedCase(req, id) {
  if (!hasDb) return null;
  return one("select id, org_id from cases where id = $1 and org_id = $2", [id, req.session.org_id]);
}

export function mountAi(app) {
  app.get("/api/ai/config", (req, res) => {
    res.json({ enabled: aiEnabled(), transcription: transcriptionEnabled(), model: AI_MODEL, effort: AI_EFFORT, reference: loadReference().version });
  });

  // --- transcription: the phone sends one voice note as raw audio -------------
  app.post("/api/ai/cases/:id/rooms/:roomId/transcribe", guard,
    express.raw({ type: ["audio/*", "video/webm", "application/octet-stream"], limit: "25mb" }),
    wrap(async (req, res) => {
      if (!transcriptionEnabled()) return res.status(501).json({ error: "transcription_off", message: "Voice notes can't be transcribed on this server yet — set OPENAI_API_KEY." });
      if (!CASE_ID.test(req.params.id) || !ROOM_ID.test(req.params.roomId)) return res.status(400).json({ error: "bad_id" });
      if (!Buffer.isBuffer(req.body) || req.body.length < 200) return res.status(400).json({ error: "no_audio" });
      if (!rateLimit(`ai:transcribe:${who(req)}`, 120, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
      const memoId = String(req.get("x-memo-id") || "").slice(0, 80);
      const text = await transcribeAudio({ buffer: req.body, mime: req.get("content-type"), filename: String(req.get("x-filename") || "note.webm").slice(0, 120) });
      const owned = await ownedCase(req, req.params.id);
      if (owned && memoId) {
        await q(`insert into transcripts (memo_id, case_id, org_id, room_id, text, provider) values ($1, $2, $3, $4, $5, $6)
                 on conflict (memo_id) do update set text = excluded.text, provider = excluded.provider, created_at = now()`,
          [memoId, owned.id, owned.org_id, req.params.roomId, text, process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1"]);
      }
      res.json({ text });
    }));

  // --- drafting: one room, its notes, transcripts and photographs ---------------
  app.post("/api/ai/cases/:id/rooms/:roomId/draft", guard,
    express.json({ limit: "64mb" }),
    wrap(async (req, res) => {
      if (!aiEnabled()) return res.status(501).json({ error: "ai_off", message: "Drafting isn't switched on for this server — set ANTHROPIC_API_KEY." });
      if (!CASE_ID.test(req.params.id) || !ROOM_ID.test(req.params.roomId)) return res.status(400).json({ error: "bad_id" });
      if (!rateLimit(`ai:draft:${who(req)}`, 60, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
      const b = req.body || {};
      const room = b.room && typeof b.room === "object" ? b.room : {};
      if (!room.name) return res.status(400).json({ error: "no_room" });
      const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, MAX_PHOTOS)
        .filter((p) => p && typeof p.dataUrl === "string" && p.dataUrl.length <= MAX_PHOTO_B64 && p.dataUrl.startsWith("data:image/"))
        .map((p) => ({ id: String(p.id || ""), no: Number.isFinite(p.no) ? p.no : null, caption: String(p.caption || "").slice(0, 300), dataUrl: p.dataUrl }));
      const transcripts = (Array.isArray(b.transcripts) ? b.transcripts : []).slice(0, MAX_TRANSCRIPTS).map((t) => String(t).slice(0, 20000)).filter(Boolean);
      const input = {
        context: {
          address: String(b.context && b.context.address || "").slice(0, 300),
          postcode: String(b.context && b.context.postcode || "").slice(0, 20),
          reference: String(b.context && b.context.reference || "").slice(0, 120),
          client: String(b.context && b.context.client || "").slice(0, 120),
          inspectedAt: String(b.context && b.context.inspectedAt || "").slice(0, 40),
          builtPre2000: typeof (b.context && b.context.builtPre2000) === "boolean" ? b.context.builtPre2000 : null,
        },
        room: {
          name: String(room.name).slice(0, 120), order: Number.isFinite(room.order) ? room.order : null,
          condition: String(room.condition || "").slice(0, 20), note: String(room.note || "").slice(0, 8000),
          hypothesis: String(room.hypothesis || "").slice(0, 2000),
        },
        transcripts, photos,
      };

      const result = await draftRoomFindings(input);
      const runId = crypto.randomUUID();
      const findings = (result.output.findings || []).map((f, i) => ({ id: crypto.randomUUID(), seq: i + 1, status: "draft", ...f }));

      const owned = await ownedCase(req, req.params.id);
      if (owned) {
        await q(`insert into drafting_runs (id, case_id, org_id, room_id, requested_by, model, reference, served_by, usage, room_summary, evidence_gaps, photos, transcripts)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [runId, owned.id, owned.org_id, req.params.roomId, req.session.user_id, result.model, result.reference, result.servedByFallback,
            JSON.stringify(result.usage), result.output.room_summary || "", JSON.stringify(result.output.evidence_gaps || []), photos.length, transcripts.length]);
        for (const f of findings) {
          const { id, seq, status, ...finding } = f;
          await q(`insert into findings (id, case_id, org_id, room_id, room_name, run_id, seq, status, finding, model, reference)
                   values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [id, owned.id, owned.org_id, req.params.roomId, input.room.name, runId, seq, status, JSON.stringify(finding), result.model, result.reference]);
        }
        await audit(req, "findings.drafted", owned.id, { room: input.room.name, findings: findings.length, model: result.model, photos: photos.length });
      }

      res.json({
        run: { id: runId, model: result.model, servedByFallback: result.servedByFallback, reference: result.reference, usage: result.usage, persisted: !!owned },
        room_summary: result.output.room_summary || "",
        evidence_gaps: result.output.evidence_gaps || [],
        findings,
      });
    }));

  if (!hasDb) return;

  // --- the register's copy: the latest run's findings for each room -------------
  app.get("/api/ai/cases/:id/findings", requireOrg, wrap(async (req, res) => {
    const owned = await ownedCase(req, req.params.id);
    if (!owned) return res.status(404).json({ error: "not_found" });
    const rows = (await q(`
      with latest as (
        select distinct on (room_id) room_id, id as run_id, room_summary, evidence_gaps, model, created_at
        from drafting_runs where case_id = $1 order by room_id, created_at desc)
      select f.id, f.room_id, f.room_name, f.seq, f.status, f.finding, f.reviewed, f.reviewed_at, f.model, f.reference, f.created_at,
             l.room_summary, l.evidence_gaps
      from findings f join latest l on l.run_id = f.run_id
      where f.case_id = $1 order by f.room_id, f.seq`, [owned.id])).rows;
    res.json({ findings: rows });
  }));

  // --- review: approve, edit (with the surveyor's wording), or reject -----------
  app.put("/api/ai/findings/:fid", requireOrg, express.json({ limit: "1mb" }), wrap(async (req, res) => {
    const fid = String(req.params.fid);
    if (!/^[0-9a-f-]{36}$/.test(fid)) return res.status(400).json({ error: "bad_id" });
    const status = String(req.body && req.body.status || "");
    if (!["draft", "approved", "edited", "rejected"].includes(status)) return res.status(400).json({ error: "bad_status" });
    const reviewed = req.body && req.body.reviewed && typeof req.body.reviewed === "object" ? req.body.reviewed : null;
    const r = await q(`update findings set status = $3, reviewed = $4, reviewed_by = $5, reviewed_at = now(), updated_at = now()
                       where id = $1 and org_id = $2 returning id`, [fid, req.session.org_id, status, reviewed ? JSON.stringify(reviewed) : null, req.session.user_id]);
    if (!r.rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  }));
}
