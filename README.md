# SiteSnap — room-by-room inspection photos

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

## Deploy (free)

**Railway**: at [railway.com/new](https://railway.com/new) choose
**Deploy from GitHub repo** and pick this repo. It builds with
`npm run build` and the `start` script runs `server/index.js`, which
serves `dist/` and hosts the cloud-link service (see `railway.json`).
After the first deploy, open the service → **Settings → Networking →
Generate Domain** to get the public HTTPS URL. To let surveyors connect
OneDrive / Google Drive with a single sign-in, add `TOKEN_KEY` and the
provider secrets under **Variables** —
[`docs/direct-cloud-link-setup.md`](docs/direct-cloud-link-setup.md).

**Vercel / Netlify / Cloudflare Pages** also work for the app itself
(import the repo, they auto-detect Vite) — but as static hosts they don't
run the cloud-link service, so the browser-only sign-in applies there.

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
  index.js              serves dist/ + the cloud-link service (OAuth, sealed tokens)
```

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
`kind=notes` POST carries the whole inspection as structured JSON, so an AI
drafting step runs once per property rather than once per photo. An optional
access key is sent as an `x-make-apikey` header.

**Full cloud setup — routing, the AI prompt and the JSON schema — is in
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
