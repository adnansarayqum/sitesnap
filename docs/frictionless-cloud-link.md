# Making the cloud link frictionless

The bar: **tap once, sign in once, never think about it again** — on an
iPhone, as an installed PWA, with no signal half the morning. Measured
against that, here is where the friction is today, what actually removes
it, and what each option costs.

## Where the friction is today

1. **Someone has to register the app.** One-off, five minutes — but it can't
   be done in a work Azure tenant whose policy only allows single-tenant
   apps (that's what blocked `azureford`). It has to be a personal Microsoft
   account and a personal Google Cloud project, per
   `docs/direct-cloud-link-setup.md`. Until this is done, the direct link
   doesn't exist at all.

2. **OneDrive re-asks for sign-in about once a day on an iPhone.** The app is
   a "single-page application" to Microsoft, and Microsoft deliberately
   issues SPAs a refresh token that lives 24 hours, non-sliding. After that,
   MSAL tries to renew through a hidden iframe using Microsoft's cookie —
   which iOS Safari (and the PWA) block as a third-party cookie. Result: a
   sign-in popup on the first upload of most days. This is by design on
   Microsoft's side; no client-side setting changes it.

3. **Google is worse.** A browser-only app never gets a refresh token from
   Google at all; access tokens last an hour, and the silent re-request goes
   through the same cookie path that iOS blocks. So "Connect Google Drive"
   comes back often. And while the Google project sits in *Testing* status,
   every grant is revoked after 7 days regardless.

4. **It's hidden.** Connecting lives in Settings; uploading lives on the
   Export tab. A fresh install has to know to visit Settings first, and the
   Export tab says nothing about where photos will go until you try.

5. **It's a step at the end.** Even when connected, filing is a thing to
   remember after the walkthrough, on a phone that may have been in a
   basement for an hour.

Items 1 and 4 are setup friction — solvable with UX. Items 2 and 3 are
*structural*: they come from the app having no backend to hold a
long-lived credential. Item 5 is the one that actually decides whether it
feels effortless.

## The shape that removes it: a small token service

A ~200-line Node service on the same Railway app, replacing the static
`serve` process. It serves the built app exactly as now, plus:

```
GET  /auth/onedrive/start      → redirect to Microsoft sign-in
GET  /auth/onedrive/callback   → exchange code, store refresh token, return a device token
GET  /token/onedrive           → (device token) → fresh access token
POST /auth/onedrive/revoke     → forget the refresh token, revoke at Microsoft
(same three for /google)
```

**Flow on the phone:** tap *Connect OneDrive* → Microsoft's page → back to
the app with a random device token, which the app keeps in IndexedDB. From
then on, whenever it uploads, it asks `/token/onedrive` for an access token
and uploads **directly to Graph / Drive, exactly as it does today** —
`msGraph.js` and `googleDrive.js` keep their upload code; only where the
token comes from changes. Files never pass through Railway.

**Why this is the fix and not a workaround:** the service is a
*confidential* OAuth client (it holds a client secret), so the providers
issue it the long-lived refresh tokens they won't give a browser:
Microsoft's slide out to 90 days of inactivity, Google's are indefinite
once the project is in *Production*. No iframes, no cookies, no popups.
One sign-in per phone, ever — including in the iOS PWA.

**What it needs**

- Railway Postgres (the free tier is plenty) with one table:
  `device_token, provider, refresh_token (encrypted), account_label, created_at`.
- Two secrets in Railway variables — the Microsoft and Google client
  secrets — plus an encryption key for the table.
- The two app registrations changed from "SPA" to "Web" platform with the
  `/auth/*/callback` URL. Google's consent screen moved to *Production*:
  allowed without Google's review because SiteSnap only asks for
  `drive.file` (a non-sensitive scope — the app can only see files it
  created).
- About a day of work, including the Settings/Export changes.

**What it commits you to.** The service holds a credential to each
surveyor's drive — not their files, but a key to write into them. That
means: encrypt at rest, a *Disconnect* that revokes at the provider (not
just locally), no logging of tokens, and keeping the store to exactly that
table. It does *not* make you a data processor for the photographs — they
still go phone → drive directly — which is the line
`docs/multi-user-architecture.md` says not to cross yet.

## The interim: zero setup for one surveyor, today

Bake a webhook URL into the build (`VITE_WEBHOOK_URL`) so a fresh install
files to Make with nothing entered on the phone; Make holds the OneDrive
connection you already made. This is an hour's work and involves no sign-in
on the phone at all. It's also the path the AI drafting step needs, so it
isn't wasted if the token service comes later.

Two honest limits: the access key can't be baked in without becoming
public (so either the surveyor types it once, or you accept that anyone
with the URL can post files to the webhook), and Make's free tier is about
1,000 operations a month — roughly a dozen 60-photo properties.

## Regardless of which: three UX changes

1. **First-run card on Home** — "Where should photos go?" with *Connect
   OneDrive* / *Connect Google Drive* / *Use a Make link* as one tap each.
   Never shown again once one is set.
2. **Export never dead-ends** — if nothing is connected, the upload button
   *is* the connect button, inline. The tab always states where files will
   go and as whom ("Filing to OneDrive · shahriar@…").
3. **Background filing** — once connected, each room's photos upload as
   they're taken, whenever there's signal, with a quiet per-room tick. The
   Export tab's *Upload* becomes "everything's already filed" most of the
   time, and a retry for whatever isn't. This is the change that makes it
   feel frictionless; the token service is what makes it *possible* (an
   hourly Google token can't file in the background for an afternoon).

## Recommendation

Token service + first-run card + background filing, in that order, about
two days in total. Do the app registrations first, under a personal
Microsoft account and a personal Google Cloud project — nothing else can
start until those exist. Skip the baked-in webhook unless the Make drafting
pipeline is going live first; if it is, it's the one-hour way to have
Shahriar filing tomorrow while the rest is built.
