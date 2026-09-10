// Speech to text. Claude reads images and documents, not audio, so voice
// notes go through a transcription provider first — OpenAI's endpoint when
// OPENAI_API_KEY is set. The result carries enough provenance for the
// transcript record the app keeps (provider, model, when, a hash of the
// audio it came from).
import crypto from "node:crypto";

export const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const MOCK = process.env.AI_MOCK === "1";

export async function transcribeAudio({ buffer, mime, filename, signal }) {
  const audioHash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const at = new Date().toISOString();
  if (MOCK) return { text: `[mock transcript of ${filename || "voice note"}, ${Math.round(buffer.length / 1024)} KB]`, provider: "mock", model: "mock", audioHash, at };
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error("Transcription is not configured (set OPENAI_API_KEY)."); e.status = 501; e.code = "transcription_off"; throw e; }
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime || "audio/webm" }), filename || "note.webm");
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "en");
  // domain vocabulary only — never an instruction the transcript could echo
  form.append("prompt", "Housing disrepair site inspection. Terms: damp, mould, condensation, penetrating damp, extractor fan, moisture readings, on the balance of probabilities, Artex, asbestos, skirting, reveal, tide mark.");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(json.error && json.error.message || `transcription failed (${r.status})`); e.status = 502; e.code = "transcription_failed"; throw e; }
  return { text: String(json.text || "").trim(), provider: "openai", model: TRANSCRIBE_MODEL, audioHash, at };
}
