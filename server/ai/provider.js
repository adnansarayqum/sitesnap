// The one place the app talks to an AI provider. Every stage of the
// findings pipeline, the caption pass and the clustering suggestion go
// through `structured()`: model selection, effort, streaming, refusal
// fallbacks, structured-output enforcement, timeouts, error mapping and
// privacy-safe telemetry live here and nowhere else. Swapping the provider
// (or running the second-opinion verifier on a different model later) means
// changing this file, not the business logic.
//
// Nothing about the inspection is logged — only the stage label, the model,
// token counts and wall-clock time.
import Anthropic from "@anthropic-ai/sdk";
import { sha } from "../reference.js";

export const AI_MODEL = process.env.AI_MODEL || "claude-fable-5-1";
// a different model for the verifier is the cheapest way to de-correlate
// generator and checker once one is chosen; same family by default
export const AI_VERIFY_MODEL = process.env.AI_VERIFY_MODEL || AI_MODEL;
export const AI_EFFORT = process.env.AI_EFFORT || "high";
export const AI_CAPTION_EFFORT = process.env.AI_CAPTION_EFFORT || "low";
// per-stage thinking depth: observation and prose are cheaper tasks than
// weighing causes; the verifier reads, it doesn't compose
export const EFFORTS = {
  evidence: process.env.AI_EFFORT_EVIDENCE || "medium",
  causation: process.env.AI_EFFORT_CAUSATION || AI_EFFORT,
  analysis: process.env.AI_EFFORT_ANALYSIS || AI_EFFORT,
  draft: process.env.AI_EFFORT_DRAFT || "medium",
  verify: process.env.AI_EFFORT_VERIFY || "medium",
  cluster: process.env.AI_EFFORT_CLUSTER || "medium",
  caption: AI_CAPTION_EFFORT,
};
// Mock output is labelled "[MOCK]" throughout and every finding it produces
// carries `mock: true`; a production process refuses to run it at all
// unless explicitly told that's intended.
export const MOCK = process.env.AI_MOCK === "1";
if (MOCK && process.env.NODE_ENV === "production" && process.env.AI_MOCK_ALLOW_PRODUCTION !== "1") {
  throw new Error("AI_MOCK=1 is set in a production process. Mock findings must never reach a real report; unset AI_MOCK or set AI_MOCK_ALLOW_PRODUCTION=1 for a deliberate test deployment.");
}

export const aiEnabled = () => MOCK || !!process.env.ANTHROPIC_API_KEY;
export const transcriptionEnabled = () => MOCK || !!process.env.OPENAI_API_KEY;

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ timeout: 15 * 60 * 1000 }); // a hard issue at high effort can take minutes
  return client;
}

// The SDK already retries a connection failure internally before giving up —
// when it still gives up, the resulting APIConnectionError carries no HTTP
// status by design, so the generic error middleware can't tell it apart from
// a genuine bug. One more attempt from a fresh connection often succeeds; if
// it still fails this turns it into a clear, retryable message.
export async function withConnectionRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    // the phone's own connection dropped mid-request (abortOnClose). Never
    // retried — the connection that just dropped would likely drop again —
    // but it needs its own status so a generic 500 doesn't stand in for it.
    if (e instanceof Anthropic.APIUserAbortError) {
      const err = new Error("The connection dropped before the AI finished — try again.");
      err.status = 499; err.code = "ai_interrupted";
      throw err;
    }
    if (!(e instanceof Anthropic.APIConnectionError)) throw e;
    try {
      return await fn();
    } catch {
      const err = new Error("Couldn't reach the AI service — check your connection and try again.");
      err.status = 503; err.code = "ai_unreachable";
      throw err;
    }
  }
}

export const promptHash = (text) => sha(text).slice(0, 16);

// `system`: [{type:"text", text}] blocks — the stable prefix; the last block
// carries the cache breakpoint so the reference text is paid for once per
// cache window. `content`: the user turn (text + image blocks). `schema`: a
// JSON Schema the reply must satisfy — the API enforces it, and `validate`
// (optional) runs afterwards for the rules a schema can't express.
export async function structured({ label, system, content, schema, effort, maxTokens = 8000, signal, model = AI_MODEL, validate }) {
  const c = getClient();
  const t0 = Date.now();
  const msg = await withConnectionRetry(() => c.beta.messages.stream({
    model,
    max_tokens: maxTokens,
    // safety classifiers may decline a request (stop_reason "refusal");
    // "default" re-runs it server-side on Anthropic's recommended fallback
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema } },
  }, signal ? { signal } : undefined).finalMessage());
  const durationMs = Date.now() - t0;
  if (msg.stop_reason === "refusal") {
    const e = new Error(`The model declined this request${msg.stop_details && msg.stop_details.category ? ` (${msg.stop_details.category})` : ""}.`);
    e.status = 422; e.code = "refusal"; throw e;
  }
  if (msg.stop_reason === "max_tokens") {
    const e = new Error(`The ${label} step ran past its output limit — try fewer photos for this issue.`); e.status = 502; e.code = "ai_truncated"; throw e;
  }
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let output;
  try { output = JSON.parse(text); } catch { const e = new Error(`The ${label} step returned malformed output.`); e.status = 502; e.code = "ai_malformed"; throw e; }
  if (validate) {
    const problem = validate(output);
    if (problem) { const e = new Error(`The ${label} step returned incomplete output: ${problem}`); e.status = 502; e.code = "ai_invalid"; throw e; }
  }
  const usage = {
    input: msg.usage.input_tokens, output: msg.usage.output_tokens,
    cacheRead: msg.usage.cache_read_input_tokens || 0, cacheWrite: msg.usage.cache_creation_input_tokens || 0,
  };
  const servedByFallback = (msg.usage && msg.usage.iterations || []).some((it) => it.type === "fallback_message") ? msg.model : null;
  console.info(`[ai] ${label} ${msg.model}${servedByFallback ? " (fallback)" : ""} in=${usage.input} (cache ${usage.cacheRead}) out=${usage.output} ${durationMs}ms`);
  return { output, model: msg.model, servedByFallback, usage, durationMs };
}

export function sumUsage(list) {
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const u of list) if (u) for (const k of Object.keys(out)) out[k] += u[k] || 0;
  return out;
}

// evidence photos arrive as data URLs; only the image types Claude reads
export function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  return m ? { media_type: m[1], data: m[2] } : null;
}
export const imageBlock = (img) => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
