# Error monitoring — Sentry

Off by default. Nothing is initialized, and no data leaves the server or the
phone, unless the environment variables below are set. This is code-side
wiring only — there is no Sentry account or project set up for this app yet;
that half is yours to do (it takes about five minutes).

## What's wired up

- **Server** (`server/sentry.js`): every error the API's own error-handling
  middleware sees with no status or a 5xx status is reported — a caller
  sending bad input (a 4xx) is not a bug to be paged for and is skipped. An
  uncaught exception or unhandled rejection is also reported before the
  process exits (Node's own default behavior on either is to exit; this
  keeps that behavior, it just reports first).
- **Client** (`src/sentry.js`, wired into `src/main.jsx`): a React error
  boundary around the whole app reports any render crash and shows a plain
  "reload" screen instead of a blank one — the surveyor's photos and notes
  are safe either way, since they're already in IndexedDB before any crash.

## Setting it up

1. Create a free account at [sentry.io](https://sentry.io) (or self-host —
   any Sentry-compatible DSN works).
2. Create two projects: one **Node** (for the server), one **React** (for
   the client). Each gives you a DSN that looks like
   `https://<key>@<org>.ingest.<region>.sentry.io/<project>`.
3. On Railway, set on the service:

   | Variable | Value | Required |
   |---|---|---|
   | `SENTRY_DSN` | the **Node** project's DSN | to turn server monitoring on |
   | `VITE_SENTRY_DSN` | the **React** project's DSN | to turn client monitoring on |
   | `SENTRY_ENVIRONMENT` | e.g. `production` | optional — defaults to `accounts`/`local` server-side, `production`/`development` client-side |

   `VITE_SENTRY_DSN` is read at **build** time (it's baked into the bundle
   Vite produces), not at runtime like the server's `SENTRY_DSN` — set it
   before the next deploy builds, not after.
4. Redeploy. The boot log line (`error monitoring: on` / `off`) confirms
   which half, if either, picked up a DSN.

You can turn either half on independently — server-only monitoring needs
just `SENTRY_DSN`; client-only needs just `VITE_SENTRY_DSN`.
