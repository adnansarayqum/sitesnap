# Cloud workflow setup (webhook → Make.com / n8n → OneDrive)

> **Drafting is not part of this workflow any more.** Findings are drafted
> inside SiteSnap on Claude, from the photographs, notes and voice notes,
> against the firm's controlled reference pack, and reviewed in the case's
> Findings tab — see `docs/ai-findings.md`. An earlier design ran an OpenAI
> drafting step in the Make scenario over the `notes` payload; that recipe
> has been removed from this document. The app still accepts a reply in that
> old shape (see "Legacy reply shape" at the end) so an existing scenario
> keeps working, but nothing new should be built on it.

This is the webhook route: SiteSnap POSTs to one URL you control, and your
workflow decides where the files go. If you just want photos to land in your
own OneDrive/Drive with no automation tool involved, see
[`direct-cloud-link-setup.md`](direct-cloud-link-setup.md) instead — the two
can also run side by side. This document is the webhook contract and a
working Make.com recipe for filing.

## What the app sends

Every upload is a separate `multipart/form-data` POST to the webhook URL saved
on the Finish screen. If an access key is set, it is sent as an
`x-make-apikey` header on every request.

All posts carry `address`, `postcode`, `inspectionId`, and `kind`. The `kind`
field is what you route on:

| `kind`  | when                | extra fields | `file` |
|---------|---------------------|--------------|--------|
| `photo` | once per photo      | `folder` (`Site photos/01. Kitchen`), `room`, `filename`, `condition`, `note` | the JPEG (compressed, <4 MB) |
| `audio` | once per voice note | `folder` (`Inspection`), `room`, `filename`, `seconds` | the recording (opus/webm or m4a) |
| `notes` | **once per inspection**, last | `folder` (`Inspection`), `filename`, `notes` (JSON string) | the same JSON as a file |

`folder` is a path relative to the address folder, so a workflow that writes
to `/Inspections/{{address}}/{{folder}}/{{filename}}` produces the same layout
the app's direct upload and ZIP export use — two sub-folders under the
address: **Site photos/** (one numbered folder per room) and **Inspection/**
(the notes record, approved findings, voice notes and the ID photo).

The `notes` payload is sent **once per property**, last, so a workflow that
wants the whole inspection as one record (to file it, index it or push it into
a case-management system) gets it in a single POST rather than per photo:

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
      "folder": "Site photos/01. Kitchen",
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
once, right at the end of upload — and it can only include what was *typed*.
If the audio route replies with the plain transcript text instead of the
generic `filed`/`Accepted`, the app treats that reply as proof the words exist
and folds them straight into that room's note before building the final
payload. (SiteSnap also transcribes voice notes itself, on the server, when it
drafts findings — this route only matters for what lands in the filed notes
record.)

### Route 3 — `kind = notes`

**OneDrive → Make an API Call** — `PUT`
`/v1.0/me/drive/root:/Inspections/{{address}}/{{folder}}/{{filename}}:/content`
with the `file` binary, so the inspection record is filed beside the photos.
Nothing else is needed on this route.
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

## Legacy reply shape

An older design had the scenario draft findings itself and reply to the
`notes` POST with them. SiteSnap still parses a reply in that shape
(`parseDraftFindings` in `src/screens/Finish.jsx`, `fromLegacyDraft` in
`src/findings.js`) and lifts each item into the Findings tab marked as a
cloud-workflow draft: unpriced, no photo evidence, no verification, low
confidence, never reportable until the surveyor approves it. It exists so a
scenario built on the old design keeps working — not as something to build
on. The shape it accepts is the JSON schema above; the drafting itself now
happens in the app (`docs/ai-findings.md`). The AI drafts; the surveyor
signs. Nothing in this pipeline should send a report without a human reading
it.
