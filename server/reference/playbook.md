# Defect playbook

One entry per defect family: what to weigh, the causes to separate, how the
remedial scope is decided, and which price-book rows and citations usually
apply. The model reads this on every request; it is not a script, it is the
firm's accumulated judgement. Add an entry when a new defect family recurs;
correct one through `corrections.md` so the change is traceable.

## Damp and mould — separating the causes

The three causes carry different obligations and different remedies, and they
can coexist in one room. Do not collapse them.

| Cause | Evidence that points to it | Evidence against |
|---|---|---|
| **Condensation** | Mould on cold surfaces (external-wall corners, window reveals, behind furniture, ceiling–wall junction); black spot mould pattern; readings elevated at the surface but not deep; extractor absent, under-powered or unused (paper test fails); no staining pattern. | High readings deep in the wall; tide marks; localised staining below a fitting or above skirting; damp on internal walls with no cold surface. |
| **Penetrating damp** | Localised staining with a defined edge; blistering or bubbling paint; damp beneath/adjacent to a bath, shower, WC, radiator, window, or on an external wall below a gutter/roof/pointing defect; readings elevated deep into the substrate. | Uniform surface mould with no staining; readings normal deep in the wall. |
| **Rising damp** | Tide mark to ~1 m on ground-floor walls; salts efflorescence; damp skirting; readings elevated at low level and falling with height. | Damp above 1.2 m; upper floors; readings uniform with height. |

Where the surveyor states one cause and the photos suggest another (or a
second, additional cause), the assessment says so and marks the disagreement —
the surveyor decides, but must see the point on review. Typical: bathroom
mould stated as condensation, but a blistered patch opposite the bath with a
defined stain edge suggests a leak as well.

- Remedial always addresses the **cause** first, then the finish: ventilation
  or leak or fabric, then treat and redecorate (MOULD-WALL / MOULD-REVEAL).
- Citations: condensation-driven mould → S9A/S10 (freedom from damp,
  ventilation) + Cat 2 Risk Hazard 1; penetrating or rising from a defective
  element → S11 LTA (structure/exterior or installation) and Hazard 1.
- Photo numbers: cite the photo that shows the pattern relied on.

## Ceiling and wall cracking, textured coatings

- **Scope is decided by extent and finish, not by the crack.** If cracking
  runs across most of the element, or a patch would leave a visibly different
  finish, the remedy is to make good the affected element (CEIL-MAKE-GOOD),
  with waste disposal and sufficient redecoration for a consistent finish.
  If it is a short, isolated crack in a sound finish, a localised repair
  (CEIL-CRACK-LOCAL) is right.
- **Say the scope without over-reaching.** "The affected ceiling area" and
  "sufficient redecoration to provide a consistent finish" set the scope
  honestly. "The entire ceiling", "throughout", "all ceilings" invite the
  other side to argue the works go beyond the defect. Do not use them unless
  the evidence shows the whole element is defective.
- **Textured coatings** (Artex-type) in pre-2000 dwellings are presumed to
  contain asbestos: works are "subject to asbestos sampling/results"
  (ASB-SAMPLE, never under £160), and the finding carries the `asbestos`
  review flag and Hazard 4 where disturbance is proposed.
- Cause: historic leak since rectified (staining but readings normal),
  live leak (elevated readings), thermal/shrinkage movement (hairline,
  following board joints), or structural movement (stepped, widening —
  `investigation_first`, S11, Hazard 29).

## Extractor fans and ventilation

- A paper test that fails or an anemometer reading below the fan's rated
  extraction is evidence of inadequate ventilation (S10 "ventilation";
  Hazard 1 where mould follows). Remedy: EXTRACT-FAN-REPLACE with a
  humidistat/timer unit.
- Absence of any mechanical extract to a bathroom/kitchen is noted as a
  contributing factor to condensation, not as disrepair on its own.

## Leaks and sanitary installations

- Bath/shower perimeter sealant failure with damp below: S11 (installation
  for sanitation); SEALANT-BATH, and MOULD-WALL/REDEC where finishes are
  affected. If the source is not established, `investigation_first` with
  LEAK-TRACE and the review flag `scope_uncertain`.

## External fabric

- Blocked or misaligned gutters with staining/damp to the wall below: S11
  (structure and exterior); GUTTER-CLEAR-REPAIR then internal finishes.
- Defective pointing with penetrating damp inside: S11; REPOINT-LOCAL.

## When the surveyor is unsure

The surveyor may say on site: "not sure what's causing this — likely X, but
look at the photos and decide." That is a hypothesis with low confidence, not
an instruction. Weigh the photos, give the most probable cause, list the
alternatives, and set `agreement` honestly (`agree`, `disagree`, `uncertain`).
If the photos do not show enough to decide, say what would (a reading, a
second visit, a sample) in `evidence_gaps`.
