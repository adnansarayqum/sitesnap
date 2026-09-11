// HTTP surface for the AI service (server/ai/*). Mounted by index.js after
// the session middleware. These routes carry photographs and audio, so they
// use their own body parsers with larger limits than the rest of /api.
//
//   GET  /api/ai/config                                          what's on, which reference versions
//   POST /api/ai/cases/:id/rooms/:roomId/transcribe               raw audio -> transcript record
//   PUT  /api/ai/transcripts/:memoId                             the surveyor's correction
//   POST /api/ai/cases/:id/rooms/:roomId/issues/:issueId/draft    one issue -> finding + run record
//   POST /api/ai/cases/:id/rooms/:roomId/cluster                  suggest how unorganised evidence groups
//   POST /api/ai/cases/:id/rooms/:roomId/caption                  photos -> captions + suggested note
//   POST /api/ai/price                                            deterministic re-pricing with surveyor quantities
//   GET  /api/ai/cases/:id/findings                               the register's copy, latest run per issue
//   GET  /api/ai/cases/:id/runs/:runId                            one run's audit record
//   PUT  /api/ai/findings/:fid                                    the surveyor's review, under the state machine
//
// In accounts mode everything is scoped to the signed-in firm and persisted
// (findings, runs, transcripts) so a case's history is auditable. In local
// mode nothing is stored server-side — the phone keeps it in the case.
import express from "express";
import crypto from "node:crypto";
import { hasDb, q, one } from "./db.js";
import { requireOrg, rateLimit, clientIp, audit } from "./auth.js";
import {
  aiEnabled, transcriptionEnabled, runIssuePipeline, captionRoomPhotos, transcribeAudio, suggestClusters, loadReference,
  referenceFingerprints, priceItems, AI_MODEL, AI_VERIFY_MODEL, EFFORTS, PIPELINE_VERSION, TRANSCRIBE_MODEL,
} from "./ai.js";
import { abortOnClose } from "./abortOnClose.js";
import { canTransition, approvalBlockers, FINDING_STATUSES } from "../shared/findingRules.js";
import { event, semaphore } from "./ai/events.js";
import { loadFirmRows, insertFirmRow, updateFirmRow, mergeReference, cleanFirmRows } from "./pricebook.js";
import { normaliseRow } from "../shared/pricebook.js";

// one surveyor's "Draft findings" is one user action (rate-limited as such)
// that makes several provider calls; this protects the provider and the box
const pipelines = semaphore(Number(process.env.AI_MAX_CONCURRENT_PIPELINES) || 4);

const CASE_ID = /^insp_[\w-]{4,60}$/;
const ROOM_ID = /^room_[\w-]{4,60}$/;
const ISSUE_ID = /^(iss|room|legacy)_[\w-]{4,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// every photograph linked to an issue is analysed (batched), but a request
// still has to fit in memory and the body cap
const MAX_PHOTOS = 60;
const MAX_PHOTO_B64 = 1.5 * 1024 * 1024;
const MAX_MEMOS = 40;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// local mode has no sessions: the app is single-user and these routes are
// as open as the rest of it
const guard = hasDb ? requireOrg : (req, res, next) => next();
const who = (req) => (req.session ? `u:${req.session.user_id}` : `ip:${clientIp(req)}`);
const s = (v, n) => String(v == null ? "" : v).slice(0, n);

async function ownedCase(req, id) {
  if (!hasDb) return null;
  return one("select id, org_id from cases where id = $1 and org_id = $2", [id, req.session.org_id]);
}

// the reference pack this request prices and cites from: the file pack plus
// the firm's own rates — from the register in accounts mode, from the phone
// (cleaned like any other input) in local mode
async function refFor(req, clientRows) {
  const base = loadReference();
  if (hasDb && req.session && req.session.org_id) return mergeReference(base, await loadFirmRows(req.session.org_id));
  return mergeReference(base, cleanFirmRows(clientRows));
}

// A photograph without a usable image (the phone could not load it, or it is
// over the per-photo cap) is kept as a stub rather than dropped: the packet
// records it as missing evidence so the finding cannot claim a complete
// analysis. `dropped` counts those stubs.
function cleanPhotos(list) {
  const sent = Array.isArray(list) ? list : [];
  const photos = sent.slice(0, MAX_PHOTOS)
    .filter((p) => p && typeof p.id === "string" && p.id)
    .map((p) => {
      const usable = typeof p.dataUrl === "string" && p.dataUrl.length <= MAX_PHOTO_B64 && p.dataUrl.startsWith("data:image/");
      return { id: p.id, no: Number.isFinite(p.no) ? p.no : null, caption: s(p.caption, 300), captionSource: p.captionSource === "ai" ? "ai" : "human", dataUrl: usable ? p.dataUrl : undefined, linkSource: s(p.linkSource, 30), takenAt: Number.isFinite(p.takenAt) ? p.takenAt : null };
    });
  return { photos, dropped: photos.filter((p) => !p.dataUrl).length };
}
function cleanMemos(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_MEMOS).filter((m) => m && typeof m.id === "string").map((m) => ({
    id: m.id, secs: Number.isFinite(m.secs) ? m.secs : null, linkSource: s(m.linkSource, 30),
    transcript: m.transcript && typeof m.transcript === "object" ? {
      text: s(m.transcript.text, 20000), status: s(m.transcript.status, 20) || "unavailable", version: Number.isFinite(m.transcript.version) ? m.transcript.version : 1, provider: s(m.transcript.provider, 40),
    } : null,
  }));
}
function cleanIssue(b) {
  const i = b && typeof b === "object" ? b : {};
  return {
    id: s(i.id, 80), title: s(i.title, 120), description: s(i.description, 4000), descriptionSource: s(i.descriptionSource, 30),
    humanSuspectedCause: s(i.humanSuspectedCause, 2000), confirmedBySurveyor: !!i.confirmedBySurveyor, createdBy: s(i.createdBy, 30),
    evidence: (Array.isArray(i.evidence) ? i.evidence : []).slice(0, 200).filter((e) => e && e.id).map((e) => ({ id: s(e.id, 80), kind: s(e.kind, 10), source: s(e.source, 30) })),
  };
}
function cleanRoom(b) {
  const r = b && typeof b === "object" ? b : {};
  return { note: s(r.note, 8000), noteSource: s(r.noteSource, 30), hypothesis: s(r.hypothesis, 2000), condition: s(r.condition, 20), name: s(r.name, 120) };
}

export function mountAi(app) {
  app.get("/api/ai/config", wrap(async (req, res) => {
    const ref = await refFor(req, null);
    res.json({
      enabled: aiEnabled(), transcription: transcriptionEnabled(), model: AI_MODEL, verifyModel: AI_VERIFY_MODEL, efforts: EFFORTS,
      pipelineVersion: PIPELINE_VERSION, reference: referenceFingerprints(ref),
    });
  }));

  // --- the firm's own rates ------------------------------------------------------
  app.get("/api/price-book", guard, wrap(async (req, res) => {
    if (!hasDb) return res.json({ rows: [], local: true });
    res.json({ rows: await loadFirmRows(req.session.org_id) });
  }));

  // --- transcription: the phone sends one voice note as raw audio -------------
  app.post("/api/ai/cases/:id/rooms/:roomId/transcribe", guard,
    express.raw({ type: ["audio/*", "video/webm", "application/octet-stream"], limit: "25mb" }),
    wrap(async (req, res) => {
      if (!transcriptionEnabled()) return res.status(501).json({ error: "transcription_off", message: "Voice notes can't be transcribed on this server yet — set OPENAI_API_KEY." });
      if (!CASE_ID.test(req.params.id) || !ROOM_ID.test(req.params.roomId)) return res.status(400).json({ error: "bad_id" });
      if (!Buffer.isBuffer(req.body) || req.body.length < 200) return res.status(400).json({ error: "no_audio" });
      if (!rateLimit(`ai:transcribe:${who(req)}`, 120, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
      const memoId = s(req.get("x-memo-id"), 80);
      const { signal, finish } = abortOnClose(req, res);
      event("transcription_requested", { case: req.params.id, room: req.params.roomId, memo: memoId, bytes: req.body.length });
      let t;
      try { t = await transcribeAudio({ buffer: req.body, mime: req.get("content-type"), filename: s(req.get("x-filename") || "note.webm", 120), signal }); }
      catch (e) { event("transcription_failed", { case: req.params.id, memo: memoId, code: e.code, status: e.status }); throw e; }
      finish();
      event("transcription_completed", { case: req.params.id, memo: memoId, provider: t.provider, model: t.model, chars: t.text.length });
      const record = { memoId, text: t.text, original: t.text, status: "complete", version: 1, provider: t.provider, model: t.model, audioHash: t.audioHash, at: t.at };
      const owned = await ownedCase(req, req.params.id);
      if (owned && memoId) {
        // keyed by memo id: a retry of the same note replaces, never duplicates
        await q(`insert into transcripts (memo_id, case_id, org_id, room_id, text, provider, model, audio_hash, status, version)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, 'complete', 1)
                 on conflict (memo_id) do update set text = excluded.text, provider = excluded.provider, model = excluded.model, audio_hash = excluded.audio_hash, status = 'complete', created_at = now()`,
          [memoId, owned.id, owned.org_id, req.params.roomId, t.text, t.provider, t.model, t.audioHash]);
      }
      res.json(record);
    }));

  // --- captions: a room's photos -> a short caption each + a suggested note ----
  app.post("/api/ai/cases/:id/rooms/:roomId/caption", guard,
    express.json({ limit: "40mb" }),
    wrap(async (req, res) => {
      if (!aiEnabled()) return res.status(501).json({ error: "ai_off", message: "Captioning isn't switched on for this server — set ANTHROPIC_API_KEY." });
      if (!CASE_ID.test(req.params.id) || !ROOM_ID.test(req.params.roomId)) return res.status(400).json({ error: "bad_id" });
      if (!rateLimit(`ai:caption:${who(req)}`, 120, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
      const b = req.body || {};
      const room = b.room && typeof b.room === "object" ? b.room : {};
      if (!room.name) return res.status(400).json({ error: "no_room" });
      const { photos } = cleanPhotos(b.photos);
      if (!photos.length) return res.status(400).json({ error: "no_photos" });
      const input = { room: { name: s(room.name, 120), condition: s(room.condition, 20), note: s(room.note, 4000) }, photos: photos.slice(0, 24) };
      const { signal, finish } = abortOnClose(req, res);
      event("caption_requested", { case: req.params.id, room: req.params.roomId, photos: input.photos.length });
      let result;
      try { result = await captionRoomPhotos(input, { signal }); } catch (e) { event("caption_failed", { case: req.params.id, room: req.params.roomId, code: e.code }); throw e; }
      finish();
      event("caption_completed", { case: req.params.id, room: req.params.roomId, captions: (result.output.photos || []).filter((p) => p.caption).length, note: !!result.output.room_note });
      res.json({ model: result.model, photos: result.output.photos || [], room_note: result.output.room_note || "", at: new Date().toISOString() });
    }));

  // --- clustering: suggest how a room's unorganised evidence groups into issues --
  app.post("/api/ai/cases/:id/rooms/:roomId/cluster", guard,
    express.json({ limit: "64mb" }),
    wrap(async (req, res) => {
      if (!aiEnabled()) return res.status(501).json({ error: "ai_off", message: "Suggestions aren't switched on for this server — set ANTHROPIC_API_KEY." });
      if (!CASE_ID.test(req.params.id) || !ROOM_ID.test(req.params.roomId)) return res.status(400).json({ error: "bad_id" });
      if (!rateLimit(`ai:cluster:${who(req)}`, 60, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
      const b = req.body || {};
      const { photos } = cleanPhotos(b.photos);
      const memos = cleanMemos(b.memos);
      if (!photos.length && !memos.length) return res.status(400).json({ error: "no_evidence" });
      const room = cleanRoom(b.room);
      const { signal, finish } = abortOnClose(req, res);
      const out = await suggestClusters({
        context: { roomName: room.name || "Room" }, issue: { id: "", title: "" },
        note: room.note && room.noteSource !== "ai_generated" ? { text: room.note, source: room.noteSource } : null,
        photos, memos, readings: [],
      }, { signal });
      finish();
      event("cluster_association_suggested", { case: req.params.id, room: req.params.roomId, issues: out.issues.length, uncertain: out.uncertain.length });
      res.json(out);
    }));

  // --- the pipeline: one confirmed issue -> a finding and its run record -------
  app.post("/api/ai/cases/:id/rooms/:roomId/issues/:issueId/draft", guard,
    express.json({ limit: "96mb" }),
    wrap(async (req, res) => {
      if (!aiEnabled()) return res.status(501).json({ error: "ai_off", message: "Drafting isn't switched on for this server — set ANTHROPIC_API_KEY." });
      if (!CASE_ID.test(req.params.id) || !ROOM_ID.test(req.params.roomId) || !ISSUE_ID.test(req.params.issueId)) return res.status(400).json({ error: "bad_id" });
      if (!rateLimit(`ai:draft:${who(req)}`, 60, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
      const b = req.body || {};
      const requestId = UUID.test(String(b.requestId || "")) ? String(b.requestId).toLowerCase() : crypto.randomUUID();
      const owned = await ownedCase(req, req.params.id);
      // idempotent: a retry of a request that already completed gets the
      // same answer, not a second run and a second finding
      if (owned) {
        const prior = await one("select pipeline from drafting_runs where id = $1 and case_id = $2", [requestId, owned.id]);
        if (prior && prior.pipeline && prior.pipeline.result) return res.json({ ...prior.pipeline.result, replayed: true });
      }
      const issue = cleanIssue(b.issue);
      issue.id = req.params.issueId;
      const room = cleanRoom(b.room);
      const { photos, dropped } = cleanPhotos(b.photos);
      const memos = cleanMemos(b.memos);
      if (owned) {
        // the register is the authority on what belongs to this case: the
        // room must be one of its rooms, the issue one of that room's (or the
        // room's legacy bucket), and every photograph one the case owns — so
        // an id from another case can never be analysed under this one
        const reg = await one("select doc, created_by from cases where id = $1", [owned.id]);
        const docRooms = (reg && reg.doc && Array.isArray(reg.doc.rooms)) ? reg.doc.rooms : [];
        const docRoom = docRooms.find((r) => r && r.id === req.params.roomId);
        if (!docRoom) return res.status(403).json({ error: "room_not_in_case", message: "This room isn't in the register's copy of the case yet — wait for the sync to finish and try again." });
        const legacyId = `legacy_${req.params.roomId}`;
        if (issue.id !== legacyId && !(docRoom.issues || []).some((i) => i && i.id === issue.id)) return res.status(403).json({ error: "issue_not_in_room", message: "This issue isn't in the register's copy of the room yet — wait for the sync to finish and try again." });
        const admin = ["owner", "admin"].includes(req.membership.role);
        if (reg.created_by !== req.session.user_id && !admin) return res.status(403).json({ error: "not_your_case", message: "This case belongs to a colleague." });
        if (photos.length) {
          const ownedPhotos = new Set((await q("select id from photos where case_id = $1 and id = any($2::text[])", [owned.id, photos.map((p) => p.id)])).rows.map((r) => r.id));
          const foreign = photos.filter((p) => !ownedPhotos.has(p.id));
          if (foreign.length) return res.status(403).json({ error: "evidence_not_in_case", message: `${foreign.length} photograph${foreign.length === 1 ? " isn't" : "s aren't"} in the register's copy of this case — wait for the sync to finish and try again.` });
        }
        const docMemos = new Set(docRooms.flatMap((r) => (r.memos || []).map((m) => m.id)));
        const foreignMemos = memos.filter((m) => !docMemos.has(m.id));
        if (foreignMemos.length) return res.status(403).json({ error: "evidence_not_in_case", message: "A voice note isn't in the register's copy of this case yet — wait for the sync to finish and try again." });
      }
      // the previous run for this issue lets unchanged stages be reused;
      // `force` re-runs named stages regardless ("re-check only")
      const prior = b.prior && typeof b.prior === "object" && b.prior.stageHashes && b.prior.stages ? { stageHashes: b.prior.stageHashes, stages: b.prior.stages, models: b.prior.models || {}, evidence: b.prior.evidence || {} } : null;
      const force = (Array.isArray(b.force) ? b.force : []).map((x) => s(x, 20)).filter((x) => ["evidence", "causation", "analysis", "draft", "verification"].includes(x));
      const readings = (Array.isArray(b.readings) ? b.readings : []).slice(0, 40).filter((r) => r && r.id).map((r) => ({ id: s(r.id, 80), text: s(r.text, 300), value: s(r.value, 40), unit: s(r.unit, 20) }));
      const ctx = b.context && typeof b.context === "object" ? b.context : {};
      const overrides = {};
      if (b.quantityOverrides && typeof b.quantityOverrides === "object") for (const [k, v] of Object.entries(b.quantityOverrides)) if (Number.isFinite(Number(v))) overrides[s(k, 60)] = Number(v);
      const input = {
        requestId, snapshot: s(b.snapshot, 80),
        context: { roomName: room.name || s(ctx.roomName, 120), roomOrder: Number.isFinite(ctx.roomOrder) ? ctx.roomOrder : null, roomCondition: room.condition, builtPre2000: typeof ctx.builtPre2000 === "boolean" ? ctx.builtPre2000 : null, inspectedAt: s(ctx.inspectedAt, 40) },
        issue, room,
        note: room.note ? { text: room.note, source: room.noteSource || "legacy_unknown" } : null,
        roomHypothesis: room.hypothesis,
        photos, memos, readings, quantityOverrides: overrides,
      };
      const { signal, finish } = abortOnClose(req, res);
      const ref = await refFor(req, b.firmRows);
      event("finding_draft_requested", { case: req.params.id, room: req.params.roomId, issue: issue.id, request: requestId, photos: photos.length, memos: memos.length, by: who(req), queued: pipelines.waiting, firmRows: ref.priceBook.rows.filter((r) => r.firm).length });
      let out;
      try { out = await pipelines.run(() => runIssuePipeline(input, { signal, prior, force, ref })); }
      catch (e) {
        if (e.code === "not_eligible") { event("finding_draft_rejected", { case: req.params.id, issue: issue.id, reason: "not_eligible" }); return res.status(422).json({ error: "not_eligible", message: e.message, eligibility: e.detail }); }
        event("finding_draft_failed", { case: req.params.id, issue: issue.id, request: requestId, code: e.code, status: e.status });
        throw e;
      }
      finish();
      const { finding, run } = out;
      const findingId = crypto.randomUUID();
      const stored = { id: findingId, issueId: issue.id, roomId: req.params.roomId, runId: run.id, seq: 1, status: "draft", createdAt: run.at, evidenceFingerprint: run.snapshot, ...finding };
      const result = { run: { ...run, persisted: !!owned, droppedPhotos: dropped }, finding: stored };
      if (owned) {
        // run first (the finding references it); the run row's primary key
        // is the request id, so a racing duplicate fails loudly here rather
        // than writing twice
        await q(`insert into drafting_runs (id, case_id, org_id, room_id, issue_id, requested_by, model, reference, served_by, usage, room_summary, evidence_gaps, photos, transcripts, pipeline, pipeline_version, snapshot)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                 on conflict (id) do nothing`,
          [run.id, owned.id, owned.org_id, req.params.roomId, issue.id, req.session.user_id, run.model, run.reference.label, run.servedByFallback,
            JSON.stringify(run.usage), finding.evidence && finding.evidence.observations ? finding.evidence.observations.map((o) => o.statement).join(" ").slice(0, 2000) : "", JSON.stringify(finding.evidence_gaps || []), photos.length, memos.filter((m) => m.transcript && m.transcript.text).length,
            JSON.stringify({ ...run, result }), run.pipelineVersion, run.snapshot]);
        const { id, seq, status, ...body } = stored;
        await q(`insert into findings (id, case_id, org_id, room_id, room_name, issue_id, run_id, seq, status, finding, model, reference, gate, verification, snapshot, pipeline_version)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) on conflict (id) do nothing`,
          [id, owned.id, owned.org_id, req.params.roomId, room.name || "Room", issue.id, run.id, seq, status, JSON.stringify(body), run.model, run.reference.label, JSON.stringify(finding.gate), JSON.stringify(finding.verification), run.snapshot, run.pipelineVersion]);
        // an older draft for the same issue is superseded by this one
        await q("update findings set status = 'superseded', updated_at = now() where case_id = $1 and issue_id = $2 and id <> $3 and status in ('draft', 'review_required', 'edited')", [owned.id, issue.id, id]);
        await audit(req, "findings.drafted", owned.id, { issue: issue.title, room: room.name, gate: finding.gate.status, model: run.model, photos: photos.length, run: run.id });
      }
      res.json(result);
    }));

  // --- deterministic re-pricing when the surveyor confirms or enters quantities --
  app.post("/api/ai/price", guard, express.json({ limit: "256kb" }), wrap(async (req, res) => {
    const b = req.body || {};
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map((it) => ({
      price_book_row_id: s(it && it.price_book_row_id, 60), quantity: Number(it && it.quantity), quantity_basis: s(it && it.quantity_basis, 20), quantity_evidence: Array.isArray(it && it.quantity_evidence) ? it.quantity_evidence.map((x) => s(x, 40)) : [], reason: s(it && it.reason, 300),
    }));
    const overrides = {};
    if (b.overrides && typeof b.overrides === "object") for (const [k, v] of Object.entries(b.overrides)) if (Number.isFinite(Number(v)) && Number(v) > 0) overrides[s(k, 60)] = Number(v);
    res.json(priceItems(await refFor(req, b.firmRows), items, overrides));
  }));

  if (!hasDb) return;

  app.post("/api/price-book/rows", requireOrg, express.json({ limit: "64kb" }), wrap(async (req, res) => {
    if (!rateLimit(`pricebook:${req.session.user_id}`, 120, 60 * 60 * 1000)) return res.status(429).json({ error: "slow_down" });
    const n = normaliseRow({ ...(req.body || {}), id: undefined });
    if (!n.ok) return res.status(400).json({ error: "bad_row", message: n.error });
    const row = await insertFirmRow(req.session.org_id, req.session.user_id, n.row);
    await audit(req, "pricebook.row_added", row.id, { work: row.work, trade: row.trade, low: row.low, high: row.high, from: row.sourceCaseId });
    res.json({ row });
  }));

  app.patch("/api/price-book/rows/:id", requireOrg, express.json({ limit: "64kb" }), wrap(async (req, res) => {
    const id = s(req.params.id, 40);
    if (!/^FIRM-[A-Z0-9]{4,24}$/.test(id)) return res.status(400).json({ error: "bad_id" });
    const b = req.body || {};
    const patch = {};
    if (typeof b.active === "boolean") patch.active = b.active;
    for (const k of ["work", "trade", "unit", "notes"]) if (typeof b[k] === "string") patch[k] = b[k];
    for (const k of ["low", "high"]) if (b[k] !== undefined && b[k] !== "") patch[k] = b[k];
    const row = await updateFirmRow(req.session.org_id, id, patch);
    if (!row) return res.status(404).json({ error: "not_found" });
    await audit(req, "pricebook.row_updated", id, patch);
    res.json({ row });
  }));

  // --- the surveyor corrects a transcript; the machine's original is kept -------
  app.put("/api/ai/transcripts/:memoId", requireOrg, express.json({ limit: "256kb" }), wrap(async (req, res) => {
    const memoId = s(req.params.memoId, 80);
    const corrected = s(req.body && req.body.corrected_text, 20000);
    const r = await q(`update transcripts set corrected_text = $3, corrected_by = $4, corrected_at = now(), status = case when $3 = '' then 'complete' else 'corrected' end, version = version + 1
                       where memo_id = $1 and org_id = $2 returning version, status`, [memoId, req.session.org_id, corrected, req.session.user_id]);
    if (!r.rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, version: r.rows[0].version, status: r.rows[0].status });
  }));

  // --- the register's copy: the latest run's finding for each issue ------------
  app.get("/api/ai/cases/:id/findings", requireOrg, wrap(async (req, res) => {
    const owned = await ownedCase(req, req.params.id);
    if (!owned) return res.status(404).json({ error: "not_found" });
    const rows = (await q(`
      select f.id, f.room_id, f.room_name, f.issue_id, f.run_id, f.seq, f.status, f.finding, f.reviewed, f.reviewed_by, f.reviewed_at, f.model, f.reference,
             f.gate, f.snapshot, f.approval, f.revisions, f.pipeline_version, f.created_at, f.updated_at
      from findings f where f.case_id = $1 ${req.query.approved === "1" ? "and f.status = 'approved'" : ""} order by f.room_id, f.issue_id, f.created_at desc`, [owned.id])).rows;
    res.json({ findings: rows });
  }));

  app.get("/api/ai/cases/:id/runs/:runId", requireOrg, wrap(async (req, res) => {
    const owned = await ownedCase(req, req.params.id);
    if (!owned || !UUID.test(String(req.params.runId))) return res.status(404).json({ error: "not_found" });
    const r = await one("select id, room_id, issue_id, requested_by, model, reference, served_by, usage, pipeline, pipeline_version, snapshot, created_at from drafting_runs where id = $1 and case_id = $2", [req.params.runId, owned.id]);
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json({ run: r });
  }));

  // --- review: under the state machine, with the gate and the snapshot enforced --
  app.put("/api/ai/findings/:fid", requireOrg, express.json({ limit: "1mb" }), wrap(async (req, res) => {
    const fid = String(req.params.fid);
    if (!UUID.test(fid)) return res.status(400).json({ error: "bad_id" });
    const status = s(req.body && req.body.status, 20);
    if (!FINDING_STATUSES.includes(status) || status === "superseded") return res.status(400).json({ error: "bad_status" });
    const cur = await one("select f.status, f.gate, f.snapshot, f.approval, f.revisions, f.reviewed, c.created_by from findings f join cases c on c.id = f.case_id where f.id = $1 and f.org_id = $2", [fid, req.session.org_id]);
    if (!cur) return res.status(404).json({ error: "not_found" });
    // the review decision is the case owner's (or an admin's) — a colleague
    // reading the register cannot approve someone else's findings
    const admin = ["owner", "admin"].includes(req.membership.role);
    if (cur.created_by !== req.session.user_id && !admin) return res.status(403).json({ error: "not_your_case", message: "This case belongs to a colleague." });
    if (!canTransition(cur.status, status)) return res.status(409).json({ error: "bad_transition", message: `A ${cur.status} finding cannot become ${status}.` });
    const reviewed = req.body && req.body.reviewed && typeof req.body.reviewed === "object" ? req.body.reviewed : null;
    let approval = cur.approval;
    let revisions = Array.isArray(cur.revisions) ? cur.revisions : [];
    if (status === "approved") {
      const snapshot = s(req.body && req.body.snapshot, 80);
      const blockers = approvalBlockers({ status: cur.status, gate: cur.gate, evidenceFingerprint: cur.snapshot }, snapshot || null);
      if (blockers.length) return res.status(409).json({ error: "not_approvable", message: blockers.join("; "), blockers });
      approval = { by: req.session.user_id, at: new Date().toISOString(), snapshot: cur.snapshot, pipelineVersion: null };
    } else if (cur.status === "approved" && cur.approval) {
      // the approved version is history, not deleted
      revisions = [...revisions, { status: "approved", approval: cur.approval, reviewed: cur.reviewed, supersededAt: new Date().toISOString(), reason: s(req.body && req.body.reason, 300) || `moved to ${status}` }];
      approval = null;
    }
    const r = await q(`update findings set status = $3, reviewed = coalesce($4, reviewed), reviewed_by = $5, reviewed_at = now(), updated_at = now(), approval = $6, revisions = $7
                       where id = $1 and org_id = $2 returning id`, [fid, req.session.org_id, status, reviewed ? JSON.stringify(reviewed) : null, req.session.user_id, approval ? JSON.stringify(approval) : null, JSON.stringify(revisions)]);
    if (!r.rowCount) return res.status(404).json({ error: "not_found" });
    await audit(req, `finding.${status}`, fid, {});
    event(status === "approved" ? "finding_approved" : status === "rejected" ? "finding_rejected" : status === "review_required" ? "approval_invalidated" : "finding_edited", { finding: fid, from: cur.status, to: status, by: req.session.user_id });
    res.json({ ok: true, approval, revisions: revisions.length });
  }));
}

export { TRANSCRIBE_MODEL };
