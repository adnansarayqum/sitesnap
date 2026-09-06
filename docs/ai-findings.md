# Draft findings — the AI step

SiteSnap drafts each room's findings on Claude, from the surveyor's own notes,
voice notes and photographs, and hands them back for review in the case's
**Findings** tab. Nothing leaves the phone until the surveyor asks for a
draft; nothing reaches the report or the workbook until they approve it.

This replaces the "notes → Make.com → ChatGPT" leg of `cloud-workflow.md`.
The Make routes for filing photos still work unchanged; if a scenario also
replies with findings in the old shape, they are lifted into the new tab
marked for review — but SiteSnap's own drafts always take precedence.

## Switching it on

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Enables drafting. Without it the Findings tab explains what's missing and the button is disabled. | — |
| `AI_MODEL` | The Claude model. | `claude-fable-5-1` |
| `AI_EFFORT` | Thinking depth: `low` `medium` `high` `xhigh` `max`. `high` is right for a court-facing document; `medium` for a quicker interactive pass. | `high` |
| `OPENAI_API_KEY` | Enables voice-note transcription (Claude reads images and documents, not audio). Without it, typed notes and the stated cause still go through; voice notes are skipped and the tab says so. | — |
| `OPENAI_TRANSCRIBE_MODEL` | Speech-to-text model. | `whisper-1` |
| `AI_MOCK=1` | Deterministic stand-in for both calls — for tests and for running the app with no keys. Every mock draft is labelled as such. | off |

Set them on the Railway service like the OneDrive variables. The boot log
line reports `drafting: claude-fable-5-1` and `transcription: on` when both
are live; `GET /api/ai/config` says the same to the app.

Refusal fallbacks are on: if Anthropic's safety classifiers decline a request
(`stop_reason: refusal`), the API re-runs it server-side on their recommended
fallback model inside the same call. The Findings tab shows "· fallback"
beside the model name when that happened.

## What happens on "Draft findings"

For every room with something to work from — a typed note, a stated cause, a
voice note, or a Fair/Poor rating — the phone:

1. Sends any untranscribed voice notes to `POST /api/ai/cases/:id/rooms/:roomId/transcribe`
   and keeps the words in the case (`inspection.transcripts`), so a re-draft
   never pays for the same transcription twice.
2. Re-encodes the room's photographs at 1568px (the size Claude reads best)
   and posts them with the note, the hypothesis and the transcripts to
   `POST /api/ai/cases/:id/rooms/:roomId/draft`.
3. Merges the reply into `inspection.findings` — the case doc, so it works
   offline, syncs to the firm register like everything else, and survives
   the server having no database.

The server (`server/ai.js`) makes one Claude request per room with a
**structured output schema** — the reply is always the same JSON shape — and
the whole reference pack as a **cached system prefix**, so the firm's
knowledge is paid for once per cache window, not per room.

Each finding carries:

- **defect** — the observation, court-facing, pinned to the time of inspection
- **surveyor_hypothesis** vs **assessment.likely_cause**, with
  **agreement**: `agree` / `disagree` / `uncertain` / `no_hypothesis`, and the
  reasoning. The tab raises this as a flag the surveyor cannot scroll past.
- **legislation** in the register's citation forms, and **hhsrs_hazard**
- **remedial.works**, **scope** (`localised` / `whole_element` /
  `multiple_elements` / `investigation_first`) and **scope_rationale**
- **cost** — a range that must cite `price_book_refs`, or `unpriced: true`
- **confidence** and **review_flags**
  (`disagreement` `unpriced` `scope_uncertain` `no_photo_evidence` `legal_check` `asbestos`)

In accounts mode every run and every finding is also stored server-side
(`drafting_runs`, `findings`, `transcripts` — see `server/migrations.js`)
with the surveyor's review decision, so a case is auditable and the evals can
compare drafts to what was approved.

## Reviewing

Approve, Edit or Reject each finding. Edit opens the defect wording, the
remedial works and the cost range; saving marks it `edited` — the AI's
original is kept alongside, never overwritten. "Approve unflagged" approves
everything the model raised no flag on, in one tap. Only `approved` and
`edited` findings reach:

- the printed report (`Report (print / save PDF)`), numbered through the
  property as "Finding 1, 2, …"
- `_Inspection/findings.csv` and `_Inspection/draft-findings.json` in the ZIP
  export and on cloud upload — the CSV columns match the Scott Schedule the
  workbook macro reads
- the `findings` array in the webhook `notes` payload

## The reference pack — where the firm's knowledge lives

`server/reference/` is read on every request. Edit these files, redeploy,
and the model's behaviour changes; there is no prompt hidden in a dashboard.

| File | What it is |
|---|---|
| `legal-register.md` | Standard of proof, observation phrasing, statutes and the firm's citation forms (`S11 LTA`, `S9A LTA`, `Cat 2 Risk Hazard 1`), HHSRS hazard numbers, rules for when to cite and when to leave it blank. |
| `playbook.md` | Per defect family: how to separate causes (condensation / penetrating / rising), how scope is decided, which price rows and citations usually apply. |
| `corrections.md` | **Versioned.** Every mistake the surveyor had to fix by hand, written as the rule that prevents it. Append; never silently edit. Each rule should have an eval case. |
| `price-book.json` | Every cost the model quotes must cite a row id here. Rows marked `example` are placeholders until the firm's rates replace them; `confirmed` rows came from the surveyor. |
| `style-examples.md` | The surveyor's own approved wordings, for register — not templates. |

The Findings tab shows which versions were used ("against corrections v1 ·
price book v1"), and each stored run records it.

## Evals — making the corrections list testable

```
node server/evals/run.mjs                 # all golden cases against the real model
node server/evals/run.mjs ceiling         # cases whose file name matches
node server/evals/run.mjs --json out.json # keep every draft for reading side by side
AI_MOCK=1 node server/evals/run.mjs       # harness check only; scores mean nothing
```

`server/evals/cases/*.json` holds one case per scenario the surveyor has
corrected: the room input, the photos (paths, optional), and what a good
draft must and must not do. The two shipped cases come from the 6 September
recordings (ceiling cracking under a textured coating; bathroom damp with two
causes). When the surveyor corrects a draft, the fix goes in three places:
`corrections.md` (the rule), a case here (the test), and — if it's a price —
`price-book.json`.

## Cost and time

At `high` effort, a room with six photos is roughly 15–25k input tokens (most
of it the cached reference pack, billed at the cache-read rate after the
first room) and 2–4k output tokens; expect £0.30–£0.80 per room and 30–90
seconds. A ten-room property therefore drafts for a few pounds and a few
minutes — against the hour the surveyor reported spending on the same job by
hand. Usage per run is returned by the API (`run.usage`) and stored in
`drafting_runs` in accounts mode. Transcription is priced separately by
OpenAI, per minute of audio.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| Findings tab: "Drafting is off on this server" | `ANTHROPIC_API_KEY` is not set on the service. |
| Voice notes drafted from typed notes only | `OPENAI_API_KEY` not set; the tab says so. |
| A room fails with "The model declined this request (…)" | A refusal that the fallback could not rescue. Rare; the category is shown. Re-word the note and re-draft. |
| "ran past the output limit" | Too many findings/photos for one room; split the room or reduce photos. |
| `415 json_only` on the transcribe route | The audio was posted with a non-audio content type; the app sends the recording's own MIME type. |
| Drafts are cheap but slow | Set `AI_EFFORT=medium`; check the mock isn't on (`AI_MOCK`). |
| Every draft shows `[MOCK DRAFT …]` | `AI_MOCK=1` is set in the environment. |

## Data and privacy

Photographs and notes are sent to Anthropic's API for the duration of the
request; Claude Fable 5.1 requires the standard 30-day retention on the
Anthropic account (it is not available under zero-data-retention). Voice
notes are sent to OpenAI for transcription when that is enabled. Nothing is
sent until the surveyor presses "Draft findings", and nothing is sent for
rooms with no note, voice note, stated cause or adverse rating.
