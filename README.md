# SiteSnap — room-by-room inspection photos

A single-user PWA built for Shahriar Hussain of Stonebridge Surveyors Ltd —
installed privately via Add to Home Screen, never distributed elsewhere.

Pick the rooms, walk the property, shoot as you go. Photos are filed into
numbered room folders automatically. Rate each room Good / Fair / Poor, add
notes (damage, meter readings) or a voice memo, mark up a photo on the spot
(circle or arrow the defect), then export: to the phone's Photos app, as a
ZIP with the folder structure and notes inside, as a printable PDF report,
or straight to OneDrive / Google Drive — either through an automation
webhook, or a direct sign-in with no webhook at all (see below).

Search past jobs from the home screen, and switch on **Field mode** in
Settings for a high-contrast dark theme when shooting in direct sunlight.

The app works offline once loaded (service worker + IndexedDB) — shoot the
whole property with no signal and export when you're back online.

## Run locally

```bash
npm install
npm run dev
```

## Supported deployment

**Railway**: at [railway.com/new](https://railway.com/new) choose
**Deploy from GitHub repo** and pick this repo. It builds with
`npm run build` and the `start` script runs `server/index.js`, which
serves `dist/` and hosts the cloud-link service (see `railway.json`).
After the first deploy, open the service → **Settings → Networking →
Generate Domain** to get the public HTTPS URL. Configure
`SITESNAP_ACCESS_KEY` before enabling any server-side AI or cloud credentials.
The key is entered once in the installed PWA and exchanged for an expiring,
HttpOnly session cookie; it is never compiled into browser assets.

Exact Railway variables, key rotation/recovery, readiness monitoring,
rollback, backups and the release checklist are in the
**[production runbook](docs/production-runbook.md)**. Cloud provider setup is
in [`docs/direct-cloud-link-setup.md`](docs/direct-cloud-link-setup.md).

**Vercel / Netlify / Cloudflare Pages** can host the offline app itself
(import the repo, they auto-detect Vite) — but as static hosts they don't
run protected AI, readiness, or the cloud-link service. Railway is the
supported full deployment.

HTTPS is required (all three provide it) — the camera and the Save-to-Photos
share sheet only work on secure origins.

On iPhone: open the URL in Safari → Share → **Add to Home Screen**. It then
launches full-screen like a native app.

## Project layout

```
src/
  main.jsx              boot + service worker registration
  App.jsx               root: open inspection, rooms, photo cache, routing
  storage.js            IndexedDB — every read/write goes through here
  styles.jsx            all CSS, as design tokens + one <style> block
  screens/
    Home.jsx            tab bar, Home dashboard, Cases ledger
    CaseFile.jsx        an open case: Overview / Rooms tabs
    Walk.jsx            walkthrough capture + the in-page live camera
    Room.jsx            a room's photos, captions, on-photo annotation
    Finish.jsx          Export tab: cloud upload, ZIP, draft findings review
    Report.jsx          printable report
    Setup.jsx           new inspection (address, rooms)
    Settings.jsx        cloud links, field mode, camera check, storage
  components/           VoiceMemo, TopBar, ReorderableList
  lib/                  image pipeline, room presets, small helpers
  cloud/                OneDrive and Google Drive clients (loaded on demand),
                        service.js = the phone's side of the cloud-link service
server/
  index.js              serves dist/, the cloud-link service
  auth.js               generic request plumbing (rate limiting, cookies) the
                        cloud-link and reference-pack routes still use
  db.js / schema.sql    Postgres access (used by the reference pack / price
                        book only — optional, unrelated to sign-in)
  email.js              Resend (or log-only), used when an export emails out
```

There is no account, firm or organisation model — this is a single-client
app. Server features use one deployment access key, not a reusable secret in
the client bundle. Everything in an inspection lives on the phone. An
optional `DATABASE_URL` runs the existing migrations for reference/schema
compatibility only; it does not enable the retired account-mode routes or
turn Postgres into a backup of phone data.

The supported client is the installable web PWA. Orphaned Android/iOS native
builds are intentionally not part of this repository or CI.

## How photos are stored

Photos are compressed (max 2200px) and kept in the browser's IndexedDB, so an
inspection survives closing Safari or losing signal mid-property. Nothing is
deleted until "Close inspection" is tapped on the Finish screen.

## Two ways to get photos into the cloud

**Direct link (no automation tool needed).** In Settings, sign in with your
own Microsoft or Google account and SiteSnap writes straight into your
OneDrive or Drive. With the cloud-link service configured on the server,
that's one sign-in per phone, ever; requires a one-time, free app
registration in Azure or Google Cloud — see
[`docs/direct-cloud-link-setup.md`](docs/direct-cloud-link-setup.md).

**Webhook (Make / n8n / Zapier), with AI drafting.** The app POSTs each
photo to a webhook you control, and your workflow files it into the drive.
This route can also run an AI drafting step (Whisper transcription, draft
findings reviewed in-app) because the workflow can call an AI provider on
the file after it lands — the direct link can't do that on its own.

You can set up one, the other, or both — whichever's configured in Settings
shows up as an upload option on the Finish screen.

Each POST is `multipart/form-data` with fields:

| field       | example                          |
|-------------|----------------------------------|
| `kind`      | `photo`, `audio` or `notes`      |
| `address`   | `23 High Street`                 |
| `postcode`  | `E6 1AB`                         |
| `folder`    | `04. Kitchen`                    |
| `filename`  | `Kitchen_2.jpg`                  |
| `condition` | `Good` (or empty)                |
| `note`      | room note text (or empty)        |
| `file`      | (the JPEG, audio or JSON binary) |

Photos upload one per POST; voice notes upload as `kind=audio`; and a single
`kind=notes` POST carries the whole inspection as structured JSON, so a
workflow gets the property as one record rather than once per photo. An
optional access key is sent as an `x-make-apikey` header. (Findings are
drafted in the app itself — see `docs/ai-findings.md` — not by the workflow.)

**Full cloud setup — routing, filing and the `notes` JSON — is in
[`docs/cloud-workflow.md`](docs/cloud-workflow.md).**

### n8n recipe (3 nodes)

1. **Webhook** node — POST, binary data enabled. Copy its production URL into
   SiteSnap via Settings → Cloud upload via Make / n8n / Zapier.
2. **Microsoft OneDrive → Upload a file** node — path:
   `/Inspections/{{ $json.address }}/{{ $json.folder }}/{{ $json.filename }}`,
   binary property `file`. (Swap for the Google Drive node to use Drive.)
3. **Respond to Webhook** node — return 200 so the app marks the room done.

The app uploads sequentially, shows per-room progress, and offers a retry for
any room that fails.

## ZIP export

"Export ZIP" builds `Address, Postcode.zip` on the device containing
`01. External/`, `02. Hallway/`, … with the photos inside — hand it to the
share sheet (Save to Files → OneDrive) or download it on desktop.
