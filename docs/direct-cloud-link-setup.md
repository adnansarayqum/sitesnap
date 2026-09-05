# Direct cloud link setup (OneDrive / Google Drive, no Make needed)

SiteSnap can now write straight into your own OneDrive or Google Drive —
you sign in once from *Settings*, and every upload afterwards goes directly
from your phone to your cloud storage. No Make/n8n/Zapier scenario, no
webhook, nothing in between.

This is a genuine alternative to the Make.com pipeline in
`docs/cloud-workflow.md`, not a replacement for it — you can set up one, the
other, or both. The trade-off: the Make pipeline can also run the AI
drafting step (Whisper transcription, draft findings) because Make can call
OpenAI/Anthropic on the file after it lands. The direct link only files the
photos, voice notes and a notes JSON — nothing drafts anything for you. If
you want both, set up the Make pipeline for drafting and use the direct
link purely as a faster/simpler filing path, or vice versa.

Both providers require a **free app registration** — a one-time, five
minute setup in Azure or Google's own developer portal. SiteSnap never sees
or stores your Microsoft/Google password; you sign in through Microsoft's
or Google's own page, and only a token comes back to the app.

## Do this once, as the deployment owner — not per surveyor

The client ID you get from that registration identifies the *app*
(SiteSnap), not any particular person's account — every surveyor who uses
this deployment still signs into their own separate OneDrive/Drive. So
there's no reason to make each of them register an app and paste an ID into
Settings. Do it once yourself, then bake the ID in as a build-time
environment variable:

- `VITE_MS_CLIENT_ID` — the OneDrive client ID
- `VITE_GOOGLE_CLIENT_ID` — the Google Drive client ID

On Railway: the service → **Variables** → add either or both → the next
deploy picks them up (Vite reads them at build time). Once set, the
"App (client) ID" field disappears from Settings entirely for everyone on
that deployment — they just tap **Connect OneDrive** / **Connect Google
Drive** and sign in. Nothing else about the flow changes; a device can
still override the built-in ID by typing its own in Settings, which only
matters if you're testing a second app registration.

Set neither and the manual entry field shown below is what everyone gets
instead — fine for one person's own copy of the app, more friction for
several surveyors sharing one deployment.

## OneDrive (Microsoft)

1. Go to **portal.azure.com** and sign in with the Microsoft account whose
   OneDrive you want to use (a personal account is fine — you don't need a
   business/Azure subscription for this).
2. Search for **App registrations** → **New registration**.
3. Name it anything (e.g. "SiteSnap").
4. Under **Supported account types**, choose *Accounts in any
   organizational directory and personal Microsoft accounts*.
5. Under **Redirect URI**, choose platform **Single-page application
   (SPA)** and enter the exact URL SiteSnap is running at (e.g.
   `https://sitesnap-production-821d.up.railway.app`). No trailing slash.
6. Click **Register**. On the app's Overview page, copy the
   **Application (client) ID**.
7. Go to **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Delegated permissions** → search for and add `Files.ReadWrite`. (You
   do **not** need admin consent for this — it's a personal-scope
   permission the surveyor grants themselves the first time they connect.)
8. In SiteSnap, open **Settings** → paste the client ID into the OneDrive
   card → **Connect OneDrive** → sign in with the same Microsoft account.

That's it — uploads now go to `/Inspections/<address>/<room>/<file>` in
that account's own OneDrive, the same folder layout Make produces.

## Google Drive

1. Go to **console.cloud.google.com** and create a project (or use an
   existing one).
2. **APIs & Services** → **Enabled APIs** → enable the **Google Drive API**.
3. **APIs & Services** → **OAuth consent screen** → set it up as
   **External** (unless you have a Google Workspace), fill in the required
   fields. You can leave it in *Testing* mode and just add your own Google
   account under **Test users** — you don't need Google's review process
   for personal use, since SiteSnap only asks for the restricted
   `drive.file` scope (it can only see files it creates itself, never your
   whole Drive).
4. **APIs & Services** → **Credentials** → **Create credentials** →
   **OAuth client ID** → Application type **Web application**.
5. Under **Authorized JavaScript origins**, add the exact URL SiteSnap is
   running at (e.g. `https://sitesnap-production-821d.up.railway.app`).
   No path, no trailing slash.
6. Create it, then copy the **Client ID**.
7. In SiteSnap, open **Settings** → paste the client ID into the Google
   Drive card → **Connect Google Drive** → sign in.

**One quirk to know:** Google's access token isn't kept anywhere after you
close the tab (by design — this app has no backend to keep it safe in). On
reload, SiteSnap quietly tries to get a new one with no popup — if your
phone still has a live Google session it usually just works and you won't
notice — but that can fail (a signed-out browser, a cleared cookie jar, an
iOS PWA being stricter about this than desktop Chrome), in which case
you're asked to tap **Connect Google Drive** again. OneDrive doesn't have
this problem at all — Microsoft's library keeps you signed in across
sessions on its own.

## Where this lives in the code

- `src/cloud/msGraph.js` — OneDrive, via `@azure/msal-browser` (PKCE,
  public client, no secret).
- `src/cloud/googleDrive.js` — Google Drive, via Google Identity Services'
  token client, plus a small find-or-create-folder helper (Drive has no
  path-based upload like Graph does).
- Both are loaded on demand (dynamic `import()`), not on every app load —
  a surveyor who never sets this up never downloads either library.
