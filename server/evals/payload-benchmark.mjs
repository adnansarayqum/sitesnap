#!/usr/bin/env node
// Server-side payload benchmark for a realistic property, issue by issue.
//
// The pipeline runs PER ISSUE, so an 83-photo inspection is never one request.
// This script builds the requests the phone would send for a property with 83
// photographs spread over 18 issues (most with 3–8, one deliberately heavy),
// measures their sizes, and times the server's side of each — body parse,
// packet build, mock pipeline — with the heap delta. The server's rejection
// limit (60 photos × 1.5 MB data URLs) is computed separately and labelled as
// the worst case it is, not as normal behaviour.
//
// What it does NOT measure (needs a real phone and a real model): browser
// memory during re-encoding, canvas re-encode time, upload duration on 4G,
// model latency, failed-request rate, cost. Photo bytes are an ASSUMPTION:
// the client re-encodes each photo to ≤1568 px JPEG q0.8 for the AI copy,
// which on typical phone photographs lands around 250–450 KB; pass --ai-kb to
// change the assumed mean. Bytes are random (the mock never decodes them).
//
//   AI_MOCK=1 node --expose-gc server/evals/payload-benchmark.mjs [--ai-kb 350] [--seed 7]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIssuePipeline, MOCK } from "../ai.js";
import { buildPacket } from "../ai/packet.js";
import { prng } from "./lib/png.mjs";

if (!MOCK) { console.error("run with AI_MOCK=1 — this measures payloads and server work, not the model"); process.exit(2); }
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const AI_KB = arg("--ai-kb", 350);
const rnd = prng(arg("--seed", 7));
const here = path.dirname(fileURLToPath(import.meta.url));

// 83 photographs over 18 issues: one heavy (14), a long tail of 3–8, a few singletons
const DISTRIBUTION = [14, 8, 7, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 1, 1];
if (DISTRIBUTION.reduce((a, b) => a + b, 0) !== 83) throw new Error("distribution must sum to 83");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function fakeJpegDataUrl(bytes) {
  // base64 of `bytes` binary bytes = ceil(bytes/3)*4 characters
  const chars = Math.ceil(bytes / 3) * 4;
  let s = "";
  const chunk = [];
  for (let i = 0; i < 4096; i++) chunk.push(B64[Math.floor(rnd() * 64)]);
  const block = chunk.join("");
  while (s.length < chars) s += block;
  return `data:image/jpeg;base64,${s.slice(0, chars)}`;
}
const photoBytes = () => Math.round(AI_KB * 1024 * (0.7 + rnd() * 0.6)); // ±30 % around the mean

function buildRequest(issueIx, n) {
  const photos = [];
  let raw = 0;
  for (let i = 0; i < n; i++) { const b = photoBytes(); raw += b; photos.push({ id: `ph_${issueIx}_${i}`, no: i + 1, caption: i % 3 === 0 ? "mould to ceiling corner" : "", captionSource: "human", dataUrl: fakeJpegDataUrl(b), linkSource: "capture_session", takenAt: Date.now() }); }
  const memos = n > 2 ? [{ id: `m_${issueIx}`, secs: 40, linkSource: "capture_session", transcript: { text: "Voice note for this issue, about forty seconds of dictation describing the defect, the readings taken and the surveyor's view of the cause on the balance of probabilities.", status: "complete", version: 1, provider: "whisper-1" } }] : [];
  const body = {
    requestId: `00000000-0000-4000-8000-${String(issueIx).padStart(12, "0")}`, snapshot: "bench",
    context: { roomName: `Room ${issueIx}`, roomOrder: issueIx, builtPre2000: true, inspectedAt: new Date().toISOString() },
    issue: { id: `iss_bench${issueIx}`, title: `Issue ${issueIx}`, description: "Damp and mould to the external wall", descriptionSource: "human_typed", humanSuspectedCause: "Condensation", confirmedBySurveyor: true, createdBy: "surveyor", evidence: [...photos.map((p) => ({ id: p.id, kind: "photo", source: "capture_session" })), ...memos.map((m) => ({ id: m.id, kind: "memo", source: "capture_session" }))] },
    room: { name: `Room ${issueIx}`, note: "Mould to the external wall corners. Reading 18% surface.", noteSource: "human_typed", hypothesis: "Condensation", condition: "Poor" },
    note: { text: "Mould to the external wall corners. Reading 18% surface.", source: "human_typed" }, roomHypothesis: "Condensation",
    photos, memos, readings: [{ id: `rd_${issueIx}`, text: "Wall, surface", value: "18", unit: "% WME" }], quantityOverrides: {}, prior: null, force: [],
  };
  return { body, rawPhotoBytes: raw };
}

const mb = (n) => (n / (1024 * 1024)).toFixed(2);
const gc = () => { if (global.gc) global.gc(); };
const heap = () => { gc(); const m = process.memoryUsage(); return { heap: m.heapUsed, rss: m.rss }; };

const rows = [];
let totalUpload = 0, totalRaw = 0, maxReq = 0, maxIssue = null;
const base = heap();
let peakHeap = base.heap, peakRss = base.rss;
for (const [i, n] of DISTRIBUTION.entries()) {
  const { body, rawPhotoBytes } = buildRequest(i + 1, n);
  const json = JSON.stringify(body);                       // what the phone uploads
  const size = Buffer.byteLength(json);
  totalUpload += size; totalRaw += rawPhotoBytes;
  if (size > maxReq) { maxReq = size; maxIssue = i + 1; }
  const before = heap();
  const t0 = performance.now();
  const parsed = JSON.parse(json);                         // express.json()
  const t1 = performance.now();
  const packet = buildPacket(parsed);                      // hashes every photo
  const t2 = performance.now();
  await runIssuePipeline(parsed, { prior: null });         // mock stages + deterministic controls
  const t3 = performance.now();
  const m = process.memoryUsage();
  peakHeap = Math.max(peakHeap, m.heapUsed); peakRss = Math.max(peakRss, m.rss);
  const after = heap();
  rows.push({ issue: i + 1, photos: n, batches: Math.ceil(n / 10), rawMB: mb(rawPhotoBytes), reqMB: mb(size), parseMs: (t1 - t0).toFixed(0), packetMs: (t2 - t1).toFixed(0), pipelineMs: (t3 - t2).toFixed(0), heapDeltaMB: mb(after.heap - before.heap), sources: Object.keys(packet.sources).length });
}
const end = heap();

// the server refuses anything past these; a request can approach them only if
// a surveyor links 60 photographs to ONE issue at the per-photo cap
const WORST_PHOTOS = 60, WORST_B64 = 1.5 * 1024 * 1024;

const L = [];
L.push(`# Payload benchmark — 83 photographs, 18 issues (server side, mock)`);
L.push("");
L.push(`Assumed AI-copy size ${AI_KB} KB ±30 % per photograph (≤1568 px JPEG q0.8). Node ${process.version}. ${global.gc ? "GC forced between issues." : "Run with --expose-gc for cleaner heap deltas."}`);
L.push("");
L.push(`## Per issue (what the phone actually sends)`);
L.push("");
L.push(`| Issue | Photos | Evidence batches | Photo bytes (MB) | Request JSON (MB) | Parse ms | Packet ms | Mock pipeline ms | Heap Δ (MB) | Sources |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) L.push(`| ${r.issue} | ${r.photos} | ${r.batches} | ${r.rawMB} | ${r.reqMB} | ${r.parseMs} | ${r.packetMs} | ${r.pipelineMs} | ${r.heapDeltaMB} | ${r.sources} |`);
L.push("");
L.push(`## Totals`);
L.push("");
L.push(`| | |`); L.push(`|---|---|`);
L.push(`| Photographs | 83 across ${DISTRIBUTION.length} issues (median ${DISTRIBUTION[Math.floor(DISTRIBUTION.length / 2)]} per issue) |`);
L.push(`| Original photo bytes (re-encoded AI copies) | ${mb(totalRaw)} MB |`);
L.push(`| Total uploaded over the inspection | ${mb(totalUpload)} MB (base64 + JSON overhead ×${(totalUpload / totalRaw).toFixed(2)}) |`);
L.push(`| Typical issue request (median) | ${rows.map((r) => Number(r.reqMB)).sort((a, b) => a - b)[Math.floor(rows.length / 2)].toFixed(2)} MB |`);
L.push(`| Largest issue request (issue ${maxIssue}, ${DISTRIBUTION[maxIssue - 1]} photos) | ${mb(maxReq)} MB |`);
L.push(`| Server heap: start → end (after GC) | ${mb(base.heap)} → ${mb(end.heap)} MB |`);
L.push(`| Server heap / RSS peak during a request | ${mb(peakHeap)} / ${mb(peakRss)} MB |`);
L.push("");
L.push(`## Server rejection limit — worst case, NOT normal behaviour`);
L.push("");
L.push(`A request is refused beyond ${WORST_PHOTOS} photographs or a ${mb(WORST_B64)} MB data URL per photograph. Reaching it needs one issue with ${WORST_PHOTOS} linked photographs each at the cap: ≈ ${mb(WORST_PHOTOS * WORST_B64)} MB in one request (body limit 96 MB). Nothing in the realistic distribution above comes within an order of magnitude of it; the realistic question is the ${DISTRIBUTION[0]}-photo heavy issue, at ${rows[0].reqMB} MB.`);
L.push("");
L.push(`## Not measured here`);
L.push("");
L.push(`Browser memory while re-encoding; canvas re-encode time per photograph; upload duration on poor 4G/5G; model latency per stage (${rows[0].batches} evidence calls for the heavy issue, then causation, analysis, draft, verify); failed-request rate; mobile data beyond the byte counts above; provider cost. Those need a real device on a real property and a real API key — the device test the product plan already calls for.`);
L.push("");
const out = path.join(here, "results", `payload-benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, L.join("\n"));
console.log(L.join("\n"));
console.log(`\nwritten to ${path.relative(process.cwd(), out)}`);
