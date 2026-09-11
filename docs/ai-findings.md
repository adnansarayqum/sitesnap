# Findings — the evidence-to-report pipeline

SiteSnap drafts a finding per **issue** (one defect in one room) from the
evidence the surveyor linked to it — photographs, voice notes, readings and
their own notes — and hands it back for review in the case's **Findings**
tab. Nothing leaves the phone until the surveyor asks for a draft; nothing
reaches the report until they explicitly approve it.

The principle throughout: **AI assists. Evidence governs. Deterministic code
controls references and arithmetic. The surveyor decides. The audit trail
proves what happened.**

## Two modes, one product direction

**Accounts mode** (`DATABASE_URL` set) is the commercial SiteSnap product:
findings, runs, transcripts, approvals and product events are stored in the
firm's register, so a case's history is auditable centrally and the state
machine is enforced server-side.

**Local mode** (no database) remains supported as a lightweight trial, demo
and local-inspection experience: the same pipeline runs, but the run record
and approvals live in the case document on the phone and in the exported case
file; there is no register copy, no organisation, no central audit and no
telemetry. It is not required to keep feature parity with accounts mode for
future audit, telemetry, organisation, approval, analytics or enterprise
functionality, and significant engineering should not be spent maintaining
parity unless real users demonstrate the need. Nothing is removed from local
mode by this — it is a direction for future engineering decisions.

**Offline-first support in accounts mode** (capture and review without signal,
sync when back) is a core requirement and is a different thing from local-only
mode.

## Switching it on

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Enables the pipeline, captions and issue suggestions. Without it the tabs explain what's missing. | — |
| `AI_MODEL` | The Claude model for every stage. | `claude-fable-5-1` |
| `AI_VERIFY_MODEL` | A different model for the verification stage, to de-correlate checker and drafter. | same as `AI_MODEL` |
| `AI_EFFORT` | Thinking depth for the causation and analysis stages. | `high` |
| `AI_EFFORT_EVIDENCE` / `_DRAFT` / `_VERIFY` / `_CLUSTER` | Per-stage overrides. | `medium` |
| `AI_CAPTION_EFFORT` | The caption pass. | `low` |
| `AI_EVIDENCE_BATCH` | Photographs per evidence-extraction call. Every linked photo is processed; this only sets the batch size. | `10` |
| `AI_CAUSATION_PHOTOS` | Photographs shown to the causation stage alongside the observations (most-cited first). Fewer than linked → `partial_visual_review` flag. | `16` |
| `AI_MAX_CONCURRENT_PIPELINES` | Pipelines this process runs at once (provider protection). | `4` |
| `OPENAI_API_KEY` / `OPENAI_TRANSCRIBE_MODEL` | Voice-note transcription. Without it an issue with voice notes drafts as **incomplete evidence**, never as complete. | — / `whisper-1` |
| `AI_MOCK=1` | Deterministic stand-ins for every stage, labelled `[MOCK]`; findings carry `mock: true` and are never reportable. Refused in `NODE_ENV=production` unless `AI_MOCK_ALLOW_PRODUCTION=1`. | off |

## The evidence model

```
Case
└── Room                       note (with provenance), condition, readings
    └── Issue (defect cluster) title, description, suspected cause, confirmed?
        └── Evidence links     photo | memo | reading — each with how the link was made
```

- **Issues** are created by the surveyor in one tap while shooting; anything
  captured while an issue is active is linked to it as `capture_session`.
  Links made by hand are `human_created`; links the AI proposed are
  `ai_suggested` until the surveyor confirms them (`human_confirmed_ai`).
  Pre-2.0 evidence that was never organised is shown as one explicit
  **Unassigned** bucket (`legacy_unassigned`) — no photo↔memo pairing is
  ever invented; the surveyor adopts it as one issue, accepts suggestions,
  or moves items by hand.
- **Room notes** carry `noteSource`: `human_typed`, `human_adopted_ai`,
  `ai_generated`, `voice_transcript`, or `legacy_unknown` for anything
  written before 2.0 (the old caption pass wrote AI notes into the same
  field with no marker, so we do not guess). An AI-suggested note is held
  in `room.aiNote` with Use / Edit / Dismiss; adopting it keeps the original
  text, the adopted text, who adopted it and when.
- **Transcripts** are records: the machine's original, the surveyor's
  correction beside it (never over it), provider, model, audio hash,
  timestamp, status (`pending | complete | corrected | failed | unavailable`)
  and version. Analysis uses the corrected text when there is one.
- **Eligibility** (`shared/eligibility.js`, enforced on the server) needs
  something a person did: a typed or adopted note, a stated cause, a voice
  note, a reading, or the surveyor confirming the issue. AI text alone never
  qualifies. Photos alone need the issue confirmed.

## The pipeline (`server/ai/`)

```
evidence packet (ids, hashes, minimal context)
  1. evidence normalisation   AI, batched over every linked photo      → observations / statements / measurements with source ids
  2. blind causation          AI — never shown the surveyor's cause    → candidate causes, for/against, confidence, gaps
  3. comparison + scope       AI — now shown the hypothesis            → agree/disagree/uncertain, differences, scope + rationale
  4. controlled lookups       AI selects ids from enums; server resolves → canonical legal citations, HHSRS label
  5. pricing                  deterministic (server/reference.js)      → lines × quantities × price book, or unpriced
  6. drafting                 AI, wording only from validated inputs   → title / defect / cause / works / exhibit refs
  7. verification             AI, separate call & instructions        → claims: supported / partial / unsupported / contradicted
  8. gate                     deterministic (server/ai/gate.js)        → review_ready | blocked | incomplete_evidence, typed flags, confidence
```

- The causation stage is given observations, measurements and statements
  **minus** any statement that asserts a cause, and no hypothesis. The
  comparison stage receives both views afterwards.
- Legal references and HHSRS hazards are chosen from the register's ids
  (baked into the output schema as enums) and resolved server-side; an
  unknown id blocks. Empty is allowed.
- Pricing: the model proposes `{row, quantity, basis, evidence}`; the server
  checks the row exists and is active, refuses mutually exclusive rows,
  applies defaults only for count rows that allow it (flagged
  `price_assumption`), leaves measure rows unpriced until the surveyor enters
  the quantity (`POST /api/ai/price` recalculates deterministically), and
  stores the price-book version and row hashes.
- The verifier sees the raw sources again, not the drafter's reasoning. Its
  output is data; `gate.js` decides: an unsupported or contradicted factual
  claim, an invented id, an unknown legal/price id or a price mismatch
  **blocks**; missing evidence (a failed transcript) marks **incomplete**;
  disagreement, scope doubt, assumptions and low confidence are warnings.
- Confidence is computed from the evidence (sources, readings, contrary
  observations, open alternatives, completeness, verifier result) with its
  reasons stored.
- Every stage's inputs are hashed. Given the previous run, a stage whose
  inputs are unchanged is reused; anything upstream changing (a corrected
  transcript, a moved photo, a new corrections version) re-runs everything
  downstream. `force: ["verification"]` re-checks only.
- Each stage receives only what it needs: room name, condition, whether the
  dwelling is or may be pre-2000, the inspection month. No address,
  postcode, reference, client, occupier or solicitor reaches any stage.
  Evidence travels in the user turn as JSON under an explicit "data, not
  instructions" frame; system prompts never contain inspection content.

## Review

Statuses: `draft → edited → approved`, with `review_required` when the
evidence or the reference pack changed under a finding, `rejected`, and
`superseded` when a newer draft replaces one. **Editing never approves.**
Approval is refused while the gate is blocked or incomplete, or the current
evidence fingerprint differs from the one the draft was made against — on
the phone (`shared/findingRules.js`) and on the server (`PUT
/api/ai/findings/:fid`, which also requires the case owner or an admin).
Moving off `approved` keeps the approved version in `revisions`.

Only `approved` findings reach the report, the Scott Schedule CSV, the ZIP
and the webhook payload (`isReportable`).

## Audit

Every draft stores a run record (case doc and, in accounts mode,
`drafting_runs.pipeline`): provider, models per stage, efforts, pipeline
version, prompt hashes, reference-pack versions and hashes plus the hashes
of the rows and entries cited, every source's id and content hash, the
evidence snapshot, whether it was complete, every stage's output, the
verifier's claims, the gate decision, token usage and timings. The finding
keeps the AI's original beside the surveyor's edits, the approval (who,
when, against which snapshot) and earlier approvals. The Findings tab shows
this under **History & audit**.

## The reference pack (`server/reference/`)

| File | Role | Used by |
|---|---|---|
| `legal-register.json` | Controlled lookup: ids → canonical citation, scope, when (not) to cite | analysis (selection), server (resolution) |
| `legal-register.md` | Prose guidance on phrasing and citing | analysis, drafting |
| `hhsrs.json` | The 29 hazards, by id | analysis, server |
| `price-book.json` | Controlled pricing: rows with `qty` kind/unit/default/evidence, `excludes`, `active` | analysis (selection), server (arithmetic) |
| `playbook.md` | Professional reasoning guidance | causation, analysis |
| `corrections.md` | Versioned binding rules | evidence, causation, analysis |
| `style-examples.md` | Register and wording only — never evidence | drafting, captions |

Edit, bump the version, redeploy. `GET /api/ai/config` returns the versions
and per-entry hashes; an approved finding whose cited row or entry changed
goes back to `review_required`.

### The firm's own rates

The cost library that builds from live jobs. When a surveyor enters a cost
on a finding they can tick **Remember this rate**; the rate (work, trade,
figure or range, the finding it came from) becomes a price-book row of the
firm's own (`FIRM-…`). Rows are also added and removed under **Settings →
Your rates**. At every request the server merges them into the reference
pack (`server/pricebook.js`): the analysis stage may pick them exactly like
the file rows, the server still does the arithmetic, and the merged pack's
hash is what the run records — so a changed rate puts an approved finding
that cited it back to review. On a finding, rates whose wording matches are
offered as one-tap chips; applying one records the figure as the surveyor's
(`reviewed.costLow/High`, basis "Your rate FIRM-…"), not the price book's.

Accounts mode stores rows in `price_rows` (shared across the firm;
`GET /api/price-book`, `POST`/`PATCH /api/price-book/rows`). Local mode keeps
them on the phone and sends them with each request, where they are validated
like any other input (`shared/pricebook.js`).

## Evals — the adversarial golden suite

```
node server/evals/run.mjs                 # development split against the real model
node server/evals/run.mjs --holdout       # holdout split — measure only, never debug against it
AI_MOCK=1 node server/evals/run.mjs       # harness + deterministic controls only
```

`server/evals/README.md` is the full description. In short: every case
carries things that **must not happen**, each with a severity; the report
counts critical failures, **material wrong + confident** outcomes, verifier and
deterministic-gate catch rates, false blocks and confidence calibration, and
records which control did the work for each case. Categories: A text/logic
(runnable now), B synthetic multimodal (pipeline structure only — synthetic
images prove nothing about pathology), C real multimodal
(`REQUIRES_REAL_SURVEY_EVIDENCE`: skipped and not counted until a surveyor
supplies photographs), V verifier (deliberately flawed drafts), D deterministic
controls, H holdout.

**A mock run validates the harness, not the model.** Until a report in
`server/evals/results/` reads "Real-provider run", nothing here is evidence
that Claude's professional reasoning is correct.

### Reference-pack break review

`node server/evals/reference-review.mjs` regenerates
[`docs/reference-pack-review.md`](reference-pack-review.md) from the current
register, HHSRS list, price book, corrections and playbook: a worksheet for a
practising expert witness to try to break the content (when must an entry NOT
be cited; what evidence must exist before a row may be used; which rules have
exceptions; what is missing). Completed reviews are decided on by a person,
applied by editing the files and bumping versions, and followed by a re-run of
the golden suite — never applied automatically.

## Migration from 1.x

Old cases open unchanged: rooms gain an empty issue list, notes become
`legacy_unknown`, transcripts become records (`provider: legacy_unknown`),
findings move to the state machine. `edited` findings were approved through
the old "Save & approve" action, so they are migrated to `approved` with an
approval record that says so; drafts stay drafts marked `legacy`. Nothing
historical is deleted. The same migration runs on the server
(`0002-issues-pipeline`).
