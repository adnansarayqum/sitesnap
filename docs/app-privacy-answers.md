# App Privacy / Data Safety answers

Both stores ask a version of the same questionnaire in their own console —
there's no API for this, it's a form you fill in by hand. This is the answer
key, grounded in exactly what the app collects (see `public/privacy.html`,
which both forms will ask you to link to).

Fill these in for whichever mode your deployment actually runs — local mode
(no accounts) collects meaningfully less than accounts mode. If you're not
sure which your published build points at, check `capacitor.config.ts`'s
`CAPACITOR_SERVER_URL` and whether that Railway service has `DATABASE_URL`
set.

## Apple — App Privacy (App Store Connect → your app → App Privacy)

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Photos or Videos | Yes | No* | No | App Functionality |
| Audio Data (voice notes) | Yes | No* | No | App Functionality |
| Email Address | Only in accounts mode | Yes | No | App Functionality (sign-in) |
| User ID | Only in accounts mode | Yes | No | App Functionality |
| Crash Data | Only if Sentry is enabled | No | No | App Functionality |
| Performance Data | Only if Sentry is enabled | No | No | App Functionality |

\* Photos/audio aren't tied to an Apple ID or account identity by SiteSnap
itself — they're tied to whichever case a surveyor filed them under. If your
deployment runs accounts mode, answer "Yes" here instead, since a case is
then associated with a signed-in user.

Answer **No** to every "used for tracking" question and to "used for
advertising or marketing" — SiteSnap has no analytics SDK, no ad network, no
cross-app tracking of any kind.

**Data retention / deletion**: cases can be deleted from within the app.
There's currently no automatic retention limit (see
`docs/app-store-submission.md`'s open items) — answer accordingly if Apple's
form asks.

## Google Play — Data Safety (Play Console → your app → App content → Data safety)

Same underlying answers, Play's own categories:

- **Photos and videos**: Collected, not shared with third parties for their
  own purposes (only uploaded to a cloud folder *you* connect — that's you
  sharing it with your own storage provider, not SiteSnap sharing it).
  Purpose: App functionality.
- **Audio files**: Collected (voice notes), same as above.
- **Personal info → Email address, Name**: Collected only in accounts mode.
  Purpose: Account management.
- **App activity → Crash logs, Diagnostics**: Collected only if Sentry (error
  monitoring) is enabled for the deployment. Purpose: App functionality
  (analytics/crash reporting).
- **Data is encrypted in transit**: Yes (HTTPS/HSTS is enforced — see
  `server/index.js`'s CSP/HSTS headers).
- **Users can request data deletion**: Yes — a case can be deleted from
  within the app; direct them to the contact address in the privacy policy
  for anything beyond that.

## Third parties data may flow to (both forms ask for this)

- **Anthropic** — photos, notes, and voice-note transcripts, only when AI
  drafting is switched on for the deployment (`ANTHROPIC_API_KEY` set).
- **OpenAI** — voice notes, only when transcription is switched on
  (`OPENAI_API_KEY` set).
- **Microsoft / Google** — whatever a user explicitly connects a cloud
  folder to.
- **Sentry** — crash/error data only, only if `SENTRY_DSN`/
  `VITE_SENTRY_DSN` are set. Configured with request bodies, cookies, and AI
  prompt/response content excluded (verified in this session's own security
  review).

## Before you fill these in

- Confirm which mode (local vs. accounts) the build you're submitting
  actually points at — the answers above differ meaningfully between them.
- Confirm whether AI drafting, transcription, and Sentry are actually
  switched on for that deployment — an unused integration doesn't need to be
  disclosed, but don't guess; check the deployment's environment variables.
