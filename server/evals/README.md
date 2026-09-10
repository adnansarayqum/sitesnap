# Golden evaluation suite

Adversarial cases for the findings pipeline (`server/ai/`). The suite exists to
answer one question before any real surveyor relies on the output:

> How often can the model reach a materially wrong professional conclusion with
> unjustified confidence — and which control, if any, stops that becoming an
> approved finding?

It does not score prose. It counts things that must be zero.

```
node server/evals/run.mjs                  development split, real model (ANTHROPIC_API_KEY)
node server/evals/run.mjs --holdout        holdout split — see "Do not tune to the test set"
node server/evals/run.mjs --all
node server/evals/run.mjs GOLDEN-A-00      filter by id or path
AI_MOCK=1 node server/evals/run.mjs        harness + deterministic controls only
node server/evals/run.mjs --verbose        every assertion, and the pipeline's event lines
```

Reports (JSON + Markdown) land in `server/evals/results/` (git-ignored). Each
records the model, verifier model, efforts, pipeline version, prompt hashes,
reference-pack versions and hashes, timestamp and token usage, so two runs can
be compared like for like.

## What a mock run proves — and does not

`AI_MOCK=1` replaces every model stage with a deterministic stand-in. A mock run
proves the harness loads, the rules evaluate, and the **server-side
deterministic controls** (price-book validation, legal/HHSRS resolution, id
validation, the arithmetic cross-check, the gate) behave. Its model-dependent
numbers — causes, confidence, verifier catches — mean nothing and the report
says so in its first line. **Never quote a mock run as AI accuracy.**

Real-model validation of Claude's professional reasoning has **not** been
performed until a report exists in `results/` whose header reads
"Real-provider run".

## Case categories

| Category | Directory | What it can test | What it cannot |
|---|---|---|---|
| **A — text / logic** | `cases/text-logic/` | Reasoning and controls on notes, transcripts, readings: anchoring, invented facts, pricing and legal discipline, injection, eligibility | Anything about reading a photograph |
| **B — synthetic multimodal** | `cases/synthetic-multimodal/` | Pipeline structure with images: exhibit ids survive batching, multi-defect isolation, unreadable frames, AI-note exclusion, caption injection. Images are generated colour fields (`fixtures/make-fixtures.mjs`) | Whether the model understands building pathology — it does not see a building |
| **C — real multimodal** | `cases/real-multimodal/` | Visible-defect interpretation, extent, competing causes, misleading photographs, remedial scope from photographs | Nothing yet: every file is `REQUIRES_REAL_SURVEY_EVIDENCE`, is skipped, and is **not counted**. A practising surveyor supplies anonymised photographs and the expected reading |
| **V — verifier** | `cases/verifier/` | Whether the verifier (and, separately, the deterministic gate) catches a deliberately flawed candidate draft: invented observation, duration, exhibit, cause, omitted contradiction, statute, money, quantity, scope | — |
| **D — deterministic** | `cases/deterministic/` | The server controls on their own: unknown/inactive/overlapping rows, unevidenced areas, invented or near-miss legal ids, unknown hazards, fabricated exhibits, tampered arithmetic | — |
| **H — holdout** | `cases/holdout/` | Twins of A cases with different wording | — |

## Case shape

See `lib/load.mjs` for the full shape. The parts that matter:

- `expected` — shorthand checks (gate, agreement, confidence cap, legal/HHSRS, rows, flags…). Failures are **major** unless the rule is invariant.
- `must_not_happen` — explicit rules with a **severity** (`critical` / `major` / `minor`) and a label a reviewer can read. This list matters more than an exact ideal answer: professional wording may vary, but some conclusions must fail.
- `allowed_uncertainty` — prose for the reviewer: which outcomes are all acceptable.
- `calibration` — `truth` (regex the correct cause matches, or `null` when no cause should be carried) and `evidence_supports` (the confidence the evidence can bear). Drives the calibration quadrants.
- Every pipeline case is also held to the **invariants** in `lib/assertions.mjs` (`INVARIANTS`): no unknown source ids, no fabricated exhibits, the hypothesis is never an evidence source, legal only from the register, no statute in prose without a register entry, no money in prose other than the computed total, every priced quantity evidenced or flagged, a material contradiction blocks, asbestos never ruled out, no invented duration or dimension.

Multi-defect rooms use `input.issues[]`; the runner adds isolation rules
automatically (own exhibits only, own sources only, no sibling wording via
`contamination_terms`).

## Severity

| | Meaning | Examples |
|---|---|---|
| **critical** | Material unsupported conclusion at confidence; invented evidence, legal authority or price; ignored contradiction; cross-defect attribution | definitive cause with alternatives open; "several months"; s.17 of an Act that does not exist; £50 for a £160 sample; exhibit 7 on an issue with two photos |
| **major** | Wrong but qualified; wrong scope or row; significant omission | whole-element scope for a 300 mm crack; MOULD-WALL without the leak; s.11 for condensation |
| **minor** | Wording | — |

## Headline metrics (in this order)

1. **Critical failures** (cases, and assertions)
2. **Material wrong + confident** — a case with a critical failure whose finding came out `review_ready` at medium/high confidence. The number to drive to zero.
3. Escaped all controls — critical failure, not blocked
4. Unsupported material claims; contradicted claims; contradicted claims presented as fact (verifier)
5. Verifier catch rate on V cases — detected by verifier / caught by deterministic gate / missed by both
6. Deterministic controls passed
7. False blocks; correct but unnecessarily blocked

Then: the **safety chain** (which control did the work: generator avoided,
eligibility, verifier, gate, legal validation, price validation, id/arithmetic
check, human review flagged, escaped) and **confidence calibration**
(correct+appropriate, correct+underconfident, correct+overconfident,
wrong+uncertain, **wrong+overconfident**).

## Do not tune to the test set

`cases/holdout/` is excluded by default. The rule:

- Iterate prompts, playbook and corrections against the **development** split.
- Run `--holdout` only to measure, never to debug. If you read a holdout case to
  understand a failure, it has become a development case: move it and write a
  new holdout twin.
- When real (Category C) cases exist in volume, reserve a fraction of them as
  holdout the same way.
- A change to `server/reference/*` or `server/ai/prompts.js` changes the hashes
  the report records; re-run both splits and compare.

## Known gaps this suite measures on purpose

- **GOLDEN-A-019** (missing photo): the packet builder drops a photograph whose
  image is unavailable without marking the packet incomplete (unlike a failed
  transcription). The case fails by design until that is addressed. It is a
  deterministic-control gap, not a model failure.
- **GOLDEN-B-005** (unreadable frame) and every V case: cannot pass under
  `AI_MOCK`; the mock verifier cannot reason. Meaningful only on a real run.

## Adding a case

Copy the nearest file, give it the next id in its letter series, write the
`why`, set `must_not_happen` before `expected`, set `calibration`, and run
`AI_MOCK=1 node server/evals/run.mjs <id>` to check it loads (rule names are
validated at load). A rule the library lacks goes in `lib/assertions.mjs` with a
one-line comment on what it reads.
