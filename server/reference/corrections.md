# Corrections list

Versioned. Every entry is a mistake the drafting model made (or would make)
that the surveyor had to fix by hand, written as the rule that prevents it.
This replaces pasting "don't do this" at the top of a chat: the list is read
on every request, it is in version control, and each rule should have an
eval case that fails without it (see `server/evals/`).

Append new entries under the current version; bump the version and date when
the list changes. Never edit an entry's meaning silently — add a new one and
mark the old one superseded.

## Version 1 — 2026-09-06

Source: the surveyor's recorded review of AI drafts (voice notes and screen
recordings, 6 September 2026).

1. **Scope follows the extent, not the crack.** Do not recommend a localised
   patch when the visible defect covers most of the element or when a patch
   would leave a visibly inconsistent finish. The tenant must not be left
   worse off than a proper repair would leave them. State the scope as
   `whole_element` and price accordingly.

2. **Do not over-reach in the wording.** Avoid "the entire ceiling", "all
   walls", "throughout the property" unless the evidence shows the whole
   element is defective. Prefer "the affected ceiling area" and "sufficient
   redecoration to provide a consistent finish". Over-reaching invites the
   defendant's solicitor to argue the works exceed the defect.

3. **Every price cites the price book.** Quote a range with the row id(s) in
   `price_book_refs`. If no row fits, set `unpriced: true`, give the basis for
   the range, and add the `unpriced` review flag. Never produce a bare figure
   from general knowledge — asbestos sampling is not £50.

4. **Photos decide scope.** Judge extent from the photographs, not from the
   wording of the note. If no photo shows the extent, set `scope_uncertain`
   and say what photo or measurement would settle it.

5. **Causation is on the balance of probabilities.** Use the phrase when
   moving from observation to cause. Observations are "was observed … at the
   time of inspection". Readings are "recorded".

6. **Disagreement is said out loud.** When the surveyor's stated hypothesis
   conflicts with what the photos and readings support, set
   `assessment.agreement` to `disagree` (or `uncertain`), give the reasons,
   and add the `disagreement` review flag. Never quietly substitute a
   different cause in the wording — the surveyor must see the point on review.

7. **Do not copy the exemplar's shape.** The style examples show register and
   sentence construction, not a template. Vary structure with the facts; a
   finding with one cause reads differently from one with two.

8. **One finding per distinct defect and cause.** Where two causes act on the
   same area (condensation plus a leak behind one wall), one finding may carry
   both, with each cause and its evidence stated separately and the remedial
   works covering both.

9. **Textured coatings are asbestos until sampled.** Any works disturbing a
   textured ceiling or wall coating in a pre-2000 dwelling are conditioned on
   sampling and results; add ASB-SAMPLE and the `asbestos` flag.

10. **Leave legislation empty rather than guess.** Only cite a section the
    note and photos clearly support. Condensation mould with the fabric in
    repair is S9A/S10 and Hazard 1, not S11.
