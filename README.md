# SiteSnap — room-by-room inspection photos

Pick the rooms, walk the property, shoot as you go. Photos are filed into
numbered room folders automatically and export three ways: to the phone's
Photos app, as a ZIP with the folder structure inside, or straight to
OneDrive / Google Drive via an automation webhook.

## Run locally

```bash
npm install
npm run dev
```

## Deploy (free)

**Vercel** (recommended): push this folder to a GitHub repo, import it at
vercel.com — it auto-detects Vite. Done. Netlify and Cloudflare Pages work
identically.

HTTPS is required (all three provide it) — the camera and the Save-to-Photos
share sheet only work on secure origins.

On iPhone: open the URL in Safari → Share → **Add to Home Screen**. It then
launches full-screen like a native app.

## How photos are stored

Photos are compressed (max 2200px) and kept in the browser's IndexedDB, so an
inspection survives closing Safari or losing signal mid-property. Nothing is
deleted until "Close inspection" is tapped on the Finish screen.

## Cloud upload without Microsoft/Google sign-in

The app never talks to OneDrive or Google Drive directly — that would need an
Azure/Google OAuth app registration. Instead it POSTs each photo to a webhook
you control (n8n, Zapier, or Make), and the workflow files it into the drive.

Each POST is `multipart/form-data` with fields:

| field      | example                          |
|------------|----------------------------------|
| `address`  | `23 High Street`                 |
| `postcode` | `E6 1AB`                         |
| `folder`   | `04. Kitchen`                    |
| `filename` | `Kitchen_2.jpg`                  |
| `file`     | (the JPEG binary)                |

### n8n recipe (3 nodes)

1. **Webhook** node — POST, binary data enabled. Copy its production URL into
   SiteSnap via "Set cloud upload link" on the Finish screen.
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
