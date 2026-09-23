# Real Multimodal Eval Cases

These cases are placeholders awaiting anonymised real photographs and surveyor confirmation from Shah. Each case tests a specific visual interpretation or causation scenario that cannot be adequately covered by synthetic data.

## Structure

Each case lives in its own `.json` file (e.g., `C-001-condensation-vs-penetrating.json`). The case payload defines:
- `calibration.truth`: the cause Shah confirmed on balance of probabilities
- `evidence.observation[]`: what the photographs show
- `evidence.statements[]`: surveyor notes or voice notes
- `evidence.measurements[]`: any moisture readings or dimensions
- `status`: currently `"REQUIRES_REAL_SURVEY_EVIDENCE"` (skipped in test runs)

## Adding Photos to a Case

When Shah provides a batch of anonymised photographs for a case:

1. **Save photos** to the case's fixture directory:
   ```
   server/evals/fixtures/REAL/C-001/
     01.jpg
     02.jpg
     03.jpg
   ```

2. **Update the case `.json` file:**
   - Set `evidence.photos[]` array with the file paths (relative to `fixtures/REAL/<case-id>/`):
     ```json
     "photos": [
       { "file": "01.jpg", "caption": "Damp patch to upper wall, black mould present" },
       { "file": "02.jpg", "caption": "Close-up of staining, tide mark visible" },
       { "file": "03.jpg", "caption": "Opposite wall — drier, no staining" }
     ]
     ```
   - Set `calibration.truth` to Shah's confirmed root cause (string, e.g., `"surface condensation"` or `"penetrating damp from concealed leak"`)
   - Update `calibration.reasoning` with Shah's confidence and the evidence he relied on

3. **Enable the case:**
   - Change `status` from `"REQUIRES_REAL_SURVEY_EVIDENCE"` to `"runnable"`

4. **Run the eval:**
   ```bash
   node server/evals/run.mjs
   ```
   The case will now execute and compare the model's evidence-reading and causation inference against Shah's confirmed truth.

## Photo Guidelines

- **Anonymise**: No faces, internal documents, postcodes, or house numbers visible
- **Cover variations**: Include photos at different angles, distances, and lighting to test robust recognition
- **Captions**: Brief, factual descriptions of what's visible (not interpretation or diagnosis)
- **Format**: JPEG or PNG, typical smartphone resolution (1080–2400px width)

## Case Summary

| Case ID | Scenario | Status | Purpose |
|---------|----------|--------|---------|
| **C-001** | Condensation vs penetrating damp | placeholder | Test staining pattern recognition (edge, tide mark, blistering) |
| **C-003** | Misleading photo | placeholder | Test whether model is misled by framing or context |
| **C-004** | Competing causes | placeholder | Test cause weighing when evidence supports multiple hypotheses |
| **C-005** | Remedial scope from photo | placeholder | Test whether extent (localised vs whole element) is inferred correctly |
| **C-006** | Photo doesn't support finding | placeholder | Test whether model identifies unsupported claims |
| **C-007** | Multiple defects | placeholder | Test clustering and separate causation per defect |
| **C-008** | Textured coating ID | placeholder | Test asbestos risk detection from photographs |
| **C-009** | (reserve) | placeholder | Available for additional scenarios |

## After Photos Arrive

Once a case has photos + Shah's confirmed cause:

1. Flip the status to `"runnable"`
2. Run the eval: `node server/evals/run.mjs`
3. The model's evidence, causation and analysis are compared against Shah's truth
4. Results are in `server/evals/results/` with pass/fail per assertion

If the model's inference diverges from Shah's confirmed cause, that becomes a calibration target: either the model needs tuning, or the evidence/photos need review.
