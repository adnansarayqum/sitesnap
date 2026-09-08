// Draft findings on Claude — the AI step of SiteSnap's report pipeline.
//
// One request per room: the surveyor's typed note and hypothesis, the
// transcripts of their voice notes, and the room's photographs go in; a
// structured set of findings comes back — defect, the surveyor's hypothesis
// against the model's own photo-grounded assessment (with an explicit
// agree / disagree / uncertain flag), cause, legislation, remedial scope with
// its rationale, and a cost range that must cite the price book.
//
// The firm's knowledge lives as files in ./reference — the legal register,
// price book, playbook, corrections list and style examples — and is sent as
// a cached system prefix, so every request pays for it once per cache window
// rather than every time. Edit those files to change the model's behaviour;
// there is no prompt hidden in a dashboard.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_DIR = path.join(__dirname, "reference");

export const AI_MODEL = process.env.AI_MODEL || "claude-fable-5-1";
// "high" by default: this is a court-facing document and correctness matters
// more than latency. Set AI_EFFORT=medium for a quicker interactive pass.
export const AI_EFFORT = process.env.AI_EFFORT || "high";
// Captioning is a much lighter task than drafting a finding — describing
// what's visible, not weighing evidence — so it defaults to a quicker,
// cheaper effort than the main draft.
export const AI_CAPTION_EFFORT = process.env.AI_CAPTION_EFFORT || "low";
const MOCK = process.env.AI_MOCK === "1";

export const aiEnabled = () => MOCK || !!process.env.ANTHROPIC_API_KEY;
export const transcriptionEnabled = () => MOCK || !!process.env.OPENAI_API_KEY;

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ timeout: 15 * 60 * 1000 }); // a hard room at high effort can take minutes
  return client;
}

// The SDK already retries a connection failure internally (up to
// max_retries) before giving up — when it still gives up, the resulting
// APIConnectionError carries no HTTP status by design (there was no
// response to have one), so the generic error middleware can't tell it
// apart from a genuine bug and shows its most defensive fallback message.
// One more attempt from a fresh connection often succeeds where the SDK's
// own quick retries didn't (a stale pooled socket, a momentary DNS blip);
// if it still fails, this turns it into a clear, retryable message instead
// of a statusless error.
export async function withConnectionRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof Anthropic.APIConnectionError) || e instanceof Anthropic.APIUserAbortError) throw e;
    try {
      return await fn();
    } catch {
      const err = new Error("Couldn't reach the AI service — check your connection and try again.");
      err.status = 503; err.code = "ai_unreachable";
      throw err;
    }
  }
}

// ---- reference pack ---------------------------------------------------------
let refCache = null;
export function loadReference(force = false) {
  if (refCache && !force) return refCache;
  const read = (f) => { try { return fs.readFileSync(path.join(REF_DIR, f), "utf8"); } catch { return ""; } };
  const priceBookRaw = read("price-book.json");
  let priceBook = { items: [] };
  try { priceBook = JSON.parse(priceBookRaw); } catch { /* an unparseable book is caught by the health check */ }
  const corrections = read("corrections.md");
  const m = /##\s*Version\s+(\d+)\s*[—-]\s*([0-9-]+)/.exec(corrections);
  refCache = {
    legal: read("legal-register.md"),
    playbook: read("playbook.md"),
    corrections,
    style: read("style-examples.md"),
    priceBook,
    priceBookRaw,
    version: m ? `corrections v${m[1]} (${m[2]}) · price book v${priceBook.version || "?"}` : "unversioned",
  };
  return refCache;
}

// ---- output schema ----------------------------------------------------------
// The shape the Findings tab, the report and the workbook export all read.
// Kept to plain JSON Schema (types, enums, required, additionalProperties)
// so structured outputs can enforce it exactly.
const S = (type, extra = {}) => ({ type, ...extra });
const str = (description) => S("string", description ? { description } : {});
const arr = (items, description) => S("array", { items, ...(description ? { description } : {}) });
const obj = (properties, description) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) });

export const FINDING_SCHEMA = obj({
  title: str("Short label for the schedule, e.g. 'Damp and mould to wall adjacent to bath'."),
  location: str("Where in the room, in the surveyor's terms."),
  defect: str("The observation, court-facing: past tense, third person, pinned to the time of inspection. Only what the note and photos support."),
  photo_refs: arr(S("integer"), "Exhibit numbers of the photos relied on. Empty if none show it."),
  surveyor_hypothesis: str("The cause the surveyor stated or implied, in their words. Empty string if they stated none."),
  assessment: obj({
    likely_cause: str("The most probable cause on the balance of probabilities, from the photos, readings and note."),
    agreement: S("string", { enum: ["agree", "disagree", "uncertain", "no_hypothesis"], description: "How the likely cause sits against the surveyor's hypothesis." }),
    reasoning: str("The evidence for and against, briefly. This is what the surveyor reads when the flag is raised."),
    alternative_causes: arr(str(), "Other causes still open, if any."),
  }),
  legislation: arr(str(), "Citations in the register's forms, e.g. 'S11 LTA', 'S9A LTA', 'S10 LTA'. Empty when the evidence does not clearly support a breach."),
  hhsrs_hazard: str("E.g. 'Cat 2 Risk Hazard 1'. Empty string if none applies."),
  remedial: obj({
    works: str("The works reasonably required, in the firm's register."),
    scope: S("string", { enum: ["localised", "whole_element", "multiple_elements", "investigation_first"] }),
    scope_rationale: str("Why this scope and not the narrower or wider one — the extent seen in the photos, the finish, the cause."),
    conditions: arr(str(), "E.g. 'subject to asbestos sampling and results'."),
  }),
  cost: obj({
    low: S("number"),
    high: S("number"),
    currency: S("string", { enum: ["GBP"] }),
    basis: str("How the range was built from the price book rows, in one line."),
    price_book_refs: arr(str(), "Row ids from the price book. Empty only when unpriced is true."),
    unpriced: S("boolean", { description: "True when no price book row fits and the range is an estimate the surveyor must check." }),
  }),
  confidence: S("string", { enum: ["high", "medium", "low"] }),
  review_flags: arr(S("string", { enum: ["disagreement", "unpriced", "scope_uncertain", "no_photo_evidence", "legal_check", "asbestos"] }), "What the surveyor must look at before approving."),
});

export const ROOM_SCHEMA = obj({
  room_summary: str("One or two sentences: what was observed in this room. No conclusions."),
  findings: arr(FINDING_SCHEMA),
  evidence_gaps: arr(str(), "What would settle an open question: a reading, a photo of an extent, a sample, a second visit."),
});

// A quick per-photo caption plus a starting-point room note — not a legal
// finding, just what's visible, so the surveyor isn't typing every caption
// by hand and can edit or clear anything the model gets wrong.
export const CAPTION_SCHEMA = obj({
  photos: arr(obj({
    id: str("The photo id exactly as supplied."),
    caption: str("Short factual caption, surveyor's plain field style — what is visible, not a diagnosis."),
  }), "One entry per photo supplied, same id and order."),
  room_note: str("A short suggested room note the surveyor can edit — overall condition and anything visible across several photos. Empty string if there is nothing worth adding."),
});

// ---- prompt -----------------------------------------------------------------
// Written for Claude Fable 5.1: goal, constraints and the reason behind
// them, not a step list. The reference pack does the detailed steering.
const CORE = `You draft findings for a housing disrepair expert report in England & Wales, working for a chartered surveyor who inspected the property and will review, edit and sign everything you produce. The report is court-facing evidence: the expert's duty is to the court, and the other side's solicitor will read every sentence looking for over-reach, invented detail or a cause that the evidence does not carry.

You receive one room at a time: the surveyor's typed note, any hypothesis they stated about cause, transcripts of the voice notes they recorded on site (free speech — hesitations and self-corrections included), and the room's photographs with their exhibit numbers. The surveyor often does not know the cause on site and says so; treat a stated cause as a hypothesis to test against the photographs and readings, not as an instruction.

What good output does:
- Describes only what the note, transcripts and photographs support. No invented measurements, dates, causes or history. If something is not evidenced, it is not in the finding — it goes in evidence_gaps.
- Reads the photographs. Extent, pattern, staining edges, tide marks, blistering, coating type, fittings nearby: the scope of the remedy and the likely cause both depend on what is visible. Cite the exhibit numbers relied on.
- Tests the surveyor's hypothesis and says the result plainly in assessment.agreement. Agree when the evidence carries it; disagree when it points elsewhere; uncertain when it could go either way. Never adjust the cause in the wording without raising the flag — the surveyor has to see the disagreement on review, not discover it later.
- Sets remedial scope honestly: wide enough that the tenant is not left with a visibly inconsistent or incomplete repair, narrow enough that it stays tied to the defect. Explain the choice in scope_rationale.
- Prices only from the price book, citing row ids. When no row fits, say so with unpriced and a basis the surveyor can check.
- Uses the register's phrases where they carry meaning — "on the balance of probabilities" for causation, "at the time of inspection" for observation — and the citation forms exactly as the register gives them. Leaves legislation empty rather than guessing.
- One finding per distinct defect and cause; two causes on one area may share a finding when each is evidenced separately.

Write in the third person, past tense, in the register shown in the style examples — heard, not copied. No commentary outside the structure. The reference pack that follows — legal register, playbook, corrections list, price book and style examples — is the firm's accumulated judgement; the corrections list in particular records exactly where earlier drafts went wrong, and each rule there is binding.`;

function systemBlocks(ref) {
  const pack = [
    "# Reference pack — " + ref.version,
    "", ref.legal, "", "---", "", ref.playbook, "", "---", "", ref.corrections, "", "---", "",
    "# Price book (JSON)", "", "```json", ref.priceBookRaw.trim(), "```", "", "---", "", ref.style,
  ].join("\n");
  return [
    { type: "text", text: CORE },
    // one breakpoint after the whole stable prefix: CORE + pack are identical
    // request to request, so everything before the room content is cached
    { type: "text", text: pack, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  return m ? { media_type: m[1], data: m[2] } : null;
}

// Builds the user turn: the room as JSON, then each photo as an image block
// with its exhibit number and caption in front of it so the model can cite it.
function userContent(input) {
  const { context, room, transcripts, photos } = input;
  const roomJson = {
    property: {
      address: context.address, postcode: context.postcode || "",
      reference: context.reference || "", client: context.client || "", inspectedAt: context.inspectedAt || "",
      built_pre_2000: context.builtPre2000 ?? null,
    },
    room: {
      name: room.name, order: room.order ?? null, condition: room.condition || "",
      typed_note: room.note || "",
      surveyor_hypothesis: room.hypothesis || "",
    },
    voice_note_transcripts: (transcripts || []).map((t, i) => ({ n: i + 1, text: t })),
    photos: (photos || []).map((p) => ({ exhibit: p.no, caption: p.caption || "" })),
  };
  const content = [{ type: "text", text: "Room to draft (JSON):\n" + JSON.stringify(roomJson, null, 2) }];
  for (const p of photos || []) {
    const img = parseDataUrl(p.dataUrl);
    if (!img) continue;
    content.push({ type: "text", text: `Exhibit ${p.no}${p.caption ? ` — ${p.caption}` : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  content.push({ type: "text", text: "Draft the findings for this room." });
  return content;
}

// ---- the call -----------------------------------------------------------------
export async function draftRoomFindings(input, { signal } = {}) {
  if (MOCK) return mockDraft(input);
  const ref = loadReference();
  const c = getClient();
  // streaming so a long-thinking request can't hit an HTTP timeout; the
  // final message is all we need. `signal` lets the caller abort the
  // Anthropic call itself when the surveyor's own connection drops —
  // otherwise a multi-minute high-effort draft nobody will read keeps
  // burning tokens and wall-clock time after they've given up on it.
  const msg = await withConnectionRetry(() => c.beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 16000,
    // safety classifiers may decline a request (stop_reason "refusal");
    // "default" re-runs it server-side on Anthropic's recommended fallback,
    // routed by refusal category, inside the same call
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemBlocks(ref),
    messages: [{ role: "user", content: userContent(input) }],
    output_config: { effort: AI_EFFORT, format: { type: "json_schema", schema: ROOM_SCHEMA } },
  }, signal ? { signal } : undefined).finalMessage());
  if (msg.stop_reason === "refusal") {
    const e = new Error(`The model declined this request${msg.stop_details && msg.stop_details.category ? ` (${msg.stop_details.category})` : ""}.`);
    e.status = 422; e.code = "refusal";
    throw e;
  }
  if (msg.stop_reason === "max_tokens") {
    const e = new Error("The draft ran past the output limit; try fewer photos for this room."); e.status = 502; throw e;
  }
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let output;
  try { output = JSON.parse(text); } catch { const e = new Error("The model's reply was not valid JSON."); e.status = 502; throw e; }
  const served = (msg.usage && msg.usage.iterations || []).some((it) => it.type === "fallback_message") ? msg.model : null;
  return {
    output,
    model: msg.model,
    servedByFallback: served,
    reference: ref.version,
    usage: {
      input: msg.usage.input_tokens, output: msg.usage.output_tokens,
      cacheRead: msg.usage.cache_read_input_tokens || 0, cacheWrite: msg.usage.cache_creation_input_tokens || 0,
    },
  };
}

// A deterministic stand-in for tests and for running the app with no key:
// shaped exactly like a real reply, and honest about being a mock.
function mockDraft(input) {
  const { room, transcripts = [], photos = [] } = input;
  const hyp = (room.hypothesis || "").trim();
  const said = [room.note || "", ...transcripts].join(" ").toLowerCase();
  const damp = /damp|mould|mold|condensation|leak/.test(said);
  const agreement = !hyp ? "no_hypothesis" : /leak|penetrat/.test(hyp.toLowerCase()) && /condensation/.test(said) ? "disagree" : "uncertain";
  const finding = {
    title: damp ? `Damp and mould to ${room.name.toLowerCase()}` : `Defect noted to ${room.name.toLowerCase()}`,
    location: room.name,
    defect: `[MOCK DRAFT — no ANTHROPIC_API_KEY] ${damp ? "Damp and mould growth was observed" : "A defect was observed"} to the ${room.name.toLowerCase()} at the time of inspection.${room.note ? ` The surveyor noted: "${room.note.trim()}".` : ""}`,
    photo_refs: photos.map((p) => p.no).filter((n) => Number.isFinite(n)).slice(0, 3),
    surveyor_hypothesis: hyp,
    assessment: {
      likely_cause: damp ? "On the balance of probabilities, condensation-related, subject to review of the photographs." : "Not established from the note.",
      agreement,
      reasoning: "Mock reasoning: the real model weighs the photographs and readings here. This text exists so the review screen can be exercised without an API key.",
      alternative_causes: damp ? ["Penetrating damp from an adjacent installation"] : [],
    },
    legislation: damp ? ["S9A LTA", "S10 LTA"] : [],
    hhsrs_hazard: damp ? "Cat 2 Risk Hazard 1" : "",
    remedial: {
      works: damp ? "The mould-affected areas should be cleaned and treated with an appropriate fungicidal treatment; defective finishes prepared, stain-blocked and redecorated with a moisture-resistant paint system." : "To be confirmed on review.",
      scope: photos.length ? "localised" : "investigation_first",
      scope_rationale: photos.length ? "Mock: extent judged from the photographs supplied." : "No photographs were supplied for this room, so the extent cannot be judged.",
      conditions: [],
    },
    cost: damp ? { low: 140, high: 260, currency: "GBP", basis: "MOULD-WALL, one wall area", price_book_refs: ["MOULD-WALL"], unpriced: false }
                : { low: 0, high: 0, currency: "GBP", basis: "No price book row fits a mock finding.", price_book_refs: [], unpriced: true },
    confidence: "low",
    review_flags: [
      ...(agreement === "disagree" ? ["disagreement"] : []),
      ...(photos.length ? [] : ["no_photo_evidence", "scope_uncertain"]),
      ...(damp ? [] : ["unpriced"]),
    ],
  };
  const hasContent = !!(room.note || transcripts.length || room.condition === "Poor" || room.condition === "Fair");
  return {
    output: {
      room_summary: hasContent ? `Mock summary for ${room.name}.` : `No note, transcript or adverse condition was recorded for ${room.name}.`,
      findings: hasContent ? [finding] : [],
      evidence_gaps: photos.length ? [] : ["Photographs of the affected area showing its full extent."],
    },
    model: "mock", servedByFallback: null, reference: loadReference().version,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

// ---- photo captions & room note ------------------------------------------------
// A fast, low-effort pass over a room's photos: what's visible in each, and
// one suggested room note from the set as a whole. This is a convenience for
// the surveyor typing on site, not part of the evidential chain — the
// surveyor can edit or clear anything before it's relied on, same as their
// own typed captions always could be.
const CAPTION_CORE = `You caption photographs from a UK housing-disrepair site inspection, for a chartered surveyor who will review and edit every caption before it's used. For each photo, write a short factual caption in the surveyor's plain field style — a few words on what is visible (e.g. "mould growth to ceiling above shower", "cracked render below sill") — not a full sentence, and no cause, diagnosis or legal conclusion; that is a separate step done later from the finished captions. If a photo already has a caption and you have nothing to add, return it unchanged rather than rewording it for its own sake.

Then, from the photos together, suggest one short room note as a starting point for the surveyor's own note — the overall condition and anything visible across more than one photo worth flagging on site. Keep it brief and plain; it exists to save typing, not to be the final wording. Return an empty string if the photos don't suggest anything worth adding.`;

function captionSystemBlocks(ref) {
  return [
    { type: "text", text: CAPTION_CORE },
    { type: "text", text: "# Style examples\n\n" + ref.style, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
}

function captionUserContent(input) {
  const { room, photos } = input;
  const content = [{
    type: "text",
    text: `Room: ${room.name}${room.condition ? ` (condition: ${room.condition})` : ""}${room.note ? `\nSurveyor's note so far: ${room.note}` : ""}`,
  }];
  for (const p of photos) {
    const img = parseDataUrl(p.dataUrl);
    if (!img) continue;
    content.push({ type: "text", text: `Photo id ${p.id}${p.caption ? ` — existing caption: "${p.caption}"` : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  content.push({ type: "text", text: "Caption each photo by id, in the same order, and suggest a room note." });
  return content;
}

export async function captionRoomPhotos(input, { signal } = {}) {
  if (MOCK) return mockCaption(input);
  const ref = loadReference();
  const c = getClient();
  const msg = await withConnectionRetry(() => c.beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: captionSystemBlocks(ref),
    messages: [{ role: "user", content: captionUserContent(input) }],
    output_config: { effort: AI_CAPTION_EFFORT, format: { type: "json_schema", schema: CAPTION_SCHEMA } },
  }, signal ? { signal } : undefined).finalMessage());
  if (msg.stop_reason === "refusal") {
    const e = new Error(`The model declined this request${msg.stop_details && msg.stop_details.category ? ` (${msg.stop_details.category})` : ""}.`);
    e.status = 422; e.code = "refusal";
    throw e;
  }
  if (msg.stop_reason === "max_tokens") {
    const e = new Error("The caption pass ran past the output limit; try fewer photos."); e.status = 502; throw e;
  }
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let output;
  try { output = JSON.parse(text); } catch { const e = new Error("The model's reply was not valid JSON."); e.status = 502; throw e; }
  return {
    output, model: msg.model,
    usage: {
      input: msg.usage.input_tokens, output: msg.usage.output_tokens,
      cacheRead: msg.usage.cache_read_input_tokens || 0, cacheWrite: msg.usage.cache_creation_input_tokens || 0,
    },
  };
}

function mockCaption(input) {
  const { room, photos = [] } = input;
  return {
    output: {
      photos: photos.map((p, i) => ({ id: p.id, caption: p.caption || `[MOCK] Photo ${i + 1} in ${room.name.toLowerCase()}` })),
      room_note: room.note ? "" : `[MOCK] General condition noted in ${room.name.toLowerCase()} — review photos.`,
    },
    model: "mock",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

// ---- transcription ------------------------------------------------------------
// Claude takes images and documents, not audio, so the voice notes go through
// a speech-to-text provider first. OpenAI's transcription endpoint when
// OPENAI_API_KEY is set; nothing otherwise (the app then drafts from typed
// notes and says the voice notes were not transcribed).
export async function transcribeAudio({ buffer, mime, filename, signal }) {
  if (MOCK) return `[mock transcript of ${filename || "voice note"}, ${Math.round(buffer.length / 1024)} KB]`;
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error("Transcription is not configured (set OPENAI_API_KEY)."); e.status = 501; throw e; }
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime || "audio/webm" }), filename || "note.webm");
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
  form.append("language", "en");
  form.append("prompt", "Housing disrepair site inspection. Terms: damp, mould, condensation, penetrating damp, extractor fan, moisture readings, on the balance of probabilities, Artex, asbestos, skirting, reveal, tide mark.");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(json.error && json.error.message || `transcription failed (${r.status})`); e.status = 502; throw e; }
  return String(json.text || "").trim();
}

// ---- workbook export ------------------------------------------------------------
// The Scott Schedule columns the firm's Excel macro reads, one row per
// approved finding. Shared by the server (evals) and the client (export).
export const SCHEDULE_COLUMNS = ["Item", "Location", "Defect", "Cause", "Legislation", "HHSRS", "Remedial works", "Scope", "Conditions", "Price low", "Price high", "Price basis", "Photos", "Confidence"];
export function scheduleRows(findingsByRoom) {
  const rows = [];
  let n = 0;
  for (const { room, findings } of findingsByRoom) {
    for (const f of findings) {
      n += 1;
      rows.push([
        n, `${room} — ${f.location}`, f.defect, f.assessment.likely_cause, f.legislation.join("; "), f.hhsrs_hazard,
        f.remedial.works, f.remedial.scope, f.remedial.conditions.join("; "),
        f.cost.unpriced ? "" : f.cost.low, f.cost.unpriced ? "" : f.cost.high, f.cost.basis,
        f.photo_refs.map((p) => `Photo ${p}`).join(", "), f.confidence,
      ]);
    }
  }
  return rows;
}
export function toCsv(rows) {
  const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [SCHEDULE_COLUMNS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
