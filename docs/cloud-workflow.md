# Cloud workflow setup (Make.com → OneDrive + AI drafting)

This is the webhook route: SiteSnap POSTs to one URL you control, and your
workflow decides what happens — including, uniquely to this route, running
an AI drafting step over the notes. If you just want photos to land in your
own OneDrive/Drive with no automation tool involved, see
[`direct-cloud-link-setup.md`](direct-cloud-link-setup.md) instead — the two
can also run side by side. This document is the webhook contract and a
working Make.com recipe.

## What the app sends

Every upload is a separate `multipart/form-data` POST to the webhook URL saved
on the Finish screen. If an access key is set, it is sent as an
`x-make-apikey` header on every request.

All posts carry `address`, `postcode`, `inspectionId`, and `kind`. The `kind`
field is what you route on:

| `kind`  | when                | extra fields | `file` |
|---------|---------------------|--------------|--------|
| `photo` | once per photo      | `folder`, `filename`, `condition`, `note` | the JPEG (compressed, <4 MB) |
| `audio` | once per voice note | `folder`, `room`, `filename`, `seconds` | the recording (opus/webm or m4a) |
| `notes` | **once per inspection**, last | `filename`, `notes` (JSON string) | the same JSON as a file |

The `notes` payload is the one the AI step reads, so drafting runs **once per
property** rather than once per photo:

```json
{
  "inspectionId": "insp_...",
  "address": "56 Vernon Road",
  "postcode": "E15 4DE",
  "inspectedAt": "2026-08-31T00:11:52.980Z",
  "totalPhotos": 24,
  "rooms": [
    {
      "order": 1,
      "folder": "01. Kitchen",
      "room": "Kitchen",
      "condition": "Poor",
      "note": "Black mould to the ceiling above the sink, extractor not working.",
      "photos": 6,
      "voiceNotes": 1
    }
  ]
}
```

## Make.com scenario

Add a **Router** straight after the webhook, with three routes filtered on
`kind`.

### Route 1 — `kind = photo` (already built)

**OneDrive → Make an API Call**
- Method `PUT`
- URL `/v1.0/me/drive/root:/Inspections/{{address}}/{{folder}}/{{filename}}:/content`
- Body: the `file` binary

Microsoft Graph creates any missing folders in the path, so no folder logic is
needed.

### Route 2 — `kind = audio`

1. **OpenAI → Create a Transcription** (Whisper) with the `file` binary.
2. **Tools → Set variable** `transcript` = the returned text.
3. **OneDrive → Make an API Call** — `PUT`
   `/v1.0/me/drive/root:/Inspections/{{address}}/{{folder}}/{{filename}}.txt:/content`
   with the transcript as the body, so the raw words are filed beside the photos.
4. **Webhooks → Webhook response** — status `200`, body = `{{transcript}}`.

That last step matters more than it looks. The app sends the `notes` payload
(the one the drafting step reads) once, right at the end of upload — and it
can only include what was *typed*. If the audio route replies with the plain
transcript text instead of the generic `filed`/`Accepted`, the app treats that
reply as proof the words exist and folds them straight into that room's note
before building the final payload. Skip this step and anything the surveyor
only said aloud never reaches the AI draft — he would have to type it as well,
which defeats the point of recording it.

### Route 3 — `kind = notes` — the drafting step

1. **OpenAI (or Anthropic) → Chat Completion** with the system prompt below and
   the `notes` JSON as the user message. Turn on structured output using the
   schema below so the response is always parseable.
2. **OneDrive → Make an API Call** — `PUT`
   `/v1.0/me/drive/root:/Inspections/{{address}}/draft-findings.json:/content`
   with the model's JSON as the body.

Your workbook then imports `draft-findings.json` from the property folder in
one step, instead of the copy-paste chain through a browser.

## System prompt

Replace the bracketed part with your own custom GPT's wording — this is a
skeleton that produces the right shape, not a substitute for your expertise.

```
You are assisting a chartered surveyor preparing a housing disrepair report in
England & Wales. You produce DRAFT text only; the surveyor reviews, edits and
signs everything before it is used.

You will receive JSON describing one property inspection: rooms in walk order,
each with a condition rating and the surveyor's own site note.

For each room that has a note or a condition of Fair or Poor, produce one or
more findings. For each finding:
- defect: state the observed defect in plain, factual, non-emotive language.
  Describe only what the note supports. Never invent observations, measurements,
  dates or causes that are not in the note.
- legislation_breached: cite the relevant obligation ONLY where the note clearly
  supports it — typically s.11 Landlord and Tenant Act 1985 (structure and
  exterior, installations for water/gas/electricity/sanitation/space and water
  heating) or the Homes (Fitness for Human Habitation) Act 2018. If the note
  does not clearly support a breach, return an empty string rather than guessing.
- remedial_action: the works reasonably required to remedy the defect.
- confidence: "high" where the note is explicit, "low" where you are inferring.

[INSERT YOUR OWN CUSTOM GPT WORDING HERE — house style, standard phrasing,
Scott Schedule conventions, and anything about how you word recommendations.]

Write in the third person, past tense, for a court-facing document. Do not
address the reader. Do not add caveats, apologies or commentary outside the
JSON.
```

## Structured-output schema

```json
{
  "type": "object",
  "properties": {
    "rooms": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "room_name": { "type": "string" },
          "folder": { "type": "string" },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "defect": { "type": "string" },
                "legislation_breached": { "type": "string" },
                "remedial_action": { "type": "string" },
                "confidence": { "type": "string", "enum": ["high", "low"] }
              },
              "required": ["defect", "legislation_breached", "remedial_action", "confidence"],
              "additionalProperties": false
            }
          }
        },
        "required": ["room_name", "folder", "findings"],
        "additionalProperties": false
      }
    }
  },
  "required": ["rooms"],
  "additionalProperties": false
}
```

## Confirming an upload actually filed

By default a Make webhook replies `Accepted` the moment it receives an
upload — before the OneDrive step runs. If that step then fails, the app has
already been told 200 and will show the inspection as **Sent**.

To get a real confirmation, make the scenario answer after it has filed the
item:

1. Webhook module → **Show advanced settings** → set the response to
   **"Wait for the scenario to be completed"** (rather than returning
   immediately).
2. Add a **Webhooks → Webhook response** module at the end of each route,
   status `200`, body `filed`.

Any body other than `Accepted` is treated as proof, and the app then shows
**Filed in the cloud** instead of **Sent to the cloud**. This matters because
these photos are evidence — a tick that means "probably arrived" is worse
than no tick at all.

## Access key

To stop anyone who has the URL writing into your OneDrive:

1. Make → **Webhooks** → your webhook → **Edit** → add an API key.
2. Enter the same key in SiteSnap under *Set cloud upload link* → *Access key*.

Both must match or uploads are rejected.

## A note on review

`confidence` exists so the low-confidence findings can be flagged in the
workbook for checking first. The AI drafts; the surveyor signs. Nothing in this
pipeline should send a report without a human reading it.
