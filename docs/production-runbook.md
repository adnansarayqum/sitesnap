# SiteSnap production runbook

## Supported model

SiteSnap is one private, installed PWA backed by one Railway service. Case
data and photographs remain in that device's IndexedDB. There are no user,
firm or organisation accounts. `DATABASE_URL` is optional and only keeps the
existing schema/migrations available; setting it does not activate account
sessions, server-side cases or backups.

Server capabilities are protected by a single deployment passphrase. The
passphrase is submitted only to `POST /api/session`; the server returns a
signed 30-day `HttpOnly; Secure; SameSite=Strict` cookie. The browser bundle
contains no access secret. Login guesses are rate-limited by client address
and globally, and state-changing protected requests must have the deployment's
same origin.

After one successful session check or unlock, the cached shell and IndexedDB
continue to work offline. A device that has never been activated stays locked
until it can reach the server. AI, cloud linking and other server operations
naturally require a network connection and a valid session.

## Railway variables

Set these in **Service → Variables**, then redeploy:

| Variable | Required | Value |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `PUBLIC_URL` | yes | Exact generated HTTPS origin: `https://sitesnap-production-821d.up.railway.app` (no path) |
| `SITESNAP_ACCESS_KEY` | yes for production server features | A unique passphrase of at least 16 characters; use 5+ random words or 32 random bytes. Never prefix it with `VITE_`. |
| `SITESNAP_SESSION_DAYS` | optional | Cookie lifetime, `1`–`90`; default `30` |
| `ANTHROPIC_API_KEY` | optional | Enables drafting/caption/intake. Without `SITESNAP_ACCESS_KEY`, protected provider routes stay fail-closed with HTTP 503 while the local app remains available. |
| `OPENAI_API_KEY` | optional | Enables transcription; same fail-closed rule |
| `TOKEN_KEY` | required for cloud OAuth | Exactly 32 random bytes encoded as 64 hexadecimal characters, used to seal cloud refresh tokens. Production rejects passphrases. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | optional | OneDrive cloud link; requires `TOKEN_KEY` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google Drive cloud link; requires `TOKEN_KEY` |
| `DATABASE_URL` | optional | Railway Postgres URL for migrations/reference schema compatibility only |
| `SENTRY_DSN` | optional | Server error monitoring; see `error-monitoring.md` |

Railway supplies `RAILWAY_GIT_COMMIT_SHA` and `RAILWAY_DEPLOYMENT_ID`; do not
override them. Other platforms may set `COMMIT_SHA` and `RELEASE_ID`.

`GET /readyz` returns the complete deployment-supplied commit value, not an
abbreviated SHA. Compare `commit` with the exact 40-character GitHub commit
selected for release. A null or mismatched value means the deployment has not
been proven to contain the reviewed revision.

Do not add the access key, provider credentials or `TOKEN_KEY` to any
`VITE_*` variable: Vite variables are public build output.

## Current activation state (verified 24 September 2026)

- `https://sitesnap-production-821d.up.railway.app/readyz` returns HTTP 200,
  version `2.1.0`, and reviewed commit
  `d131460ae4d84bd24f67821bb752c85647ce0696`. Its Railway deployment also
  passed the configured `/healthz` promotion gate. The similarly named
  `sitesnap-production.up.railway.app` hostname is not this service and must
  not be used.
- The generated origin renders successfully at desktop and mobile widths with
  no horizontal overflow or browser exceptions. The production security
  headers, manifest, hashed assets, SPA routing and fail-closed capability
  guards are active.
- `GET /api/session` currently reports `required: false` and
  `capabilitiesLocked: true`. The local capture UI remains available, but
  protected AI and OneDrive routes correctly return HTTP 503. Set
  `SITESNAP_ACCESS_KEY` in Railway and redeploy before handing the URL to the
  client; then verify the unlock screen and authenticated provider flow.
- `sitesnap.uk` currently has no A, AAAA or CNAME record, and
  `www.sitesnap.uk` is NXDOMAIN. Keep `PUBLIC_URL` on a generated Railway HTTPS
  domain until Railway provides the custom-domain target and DNS resolves;
  then set `PUBLIC_URL=https://sitesnap.uk` and redeploy. Do not activate OAuth
  providers before their callback URLs use the same working origin.
- The latest GitHub production deployment now links to the verified generated
  origin. Change it together with `PUBLIC_URL` when the custom domain is ready.
- The release branch `claude/new-session-idpxy6` is protected for administrators
  and requires the `test-and-build` status check. Continue reviewing the exact
  SHA rather than treating a mutable branch name as release identity.
- `SITESNAP_ACCESS_KEY` still needs to be set through Railway's masked
  Variables UI. Never paste it in an issue, pull request, log or chat.

## First activation

1. Establish a public HTTPS origin: use a generated Railway domain immediately,
   or configure Railway's custom-domain target in DNS and wait for
   `sitesnap.uk` to resolve publicly.
2. Set the GitHub production environment URL and Railway `PUBLIC_URL` to that
   exact origin (no path), then deploy with `NODE_ENV` and a newly generated
   `SITESNAP_ACCESS_KEY`.
3. Confirm `GET /readyz` returns `200` and that `commit` exactly equals the
   reviewed 40-character GitHub SHA; also record `version` and `release`.
4. Open the HTTPS URL, enter the access key, then install with **Add to Home
   Screen**. Load the home screen once while online so the service worker can
   precache all lazy chunks.
5. Put the device in airplane mode, reopen the installed PWA and create a
   disposable inspection. Remove it after confirming local persistence.
6. Only then add AI or cloud credentials, one provider at a time. Never test
   production setup with customer data.

## Rotation and recovery

To rotate or recover a forgotten access key, replace `SITESNAP_ACCESS_KEY` in
Railway and redeploy. Every existing session cookie immediately becomes
invalid because cookie signatures derive from that key. Enter the new key on
the device. No browser storage, cases or photographs are deleted.

If a device is lost, rotate the key immediately and revoke linked provider
access in Microsoft/Google. Rotation blocks online server capabilities but
cannot remotely erase inspections already stored in an activated device's
IndexedDB. The client device must use a strong OS passcode, device encryption
and remote-wipe capability; treat those controls as the boundary for offline
case confidentiality. Rotate `TOKEN_KEY` only when cloud links must all be
invalidated: changing it makes every sealed cloud token on the phone
unreadable, so each provider must be connected again.

## Monitoring

- Probe `GET /readyz` every 1–5 minutes. Alert on non-`200`, identity changes
  outside a deployment window, or sustained latency. The response deliberately
  contains no hostnames, credentials, database address or provider detail.
- Use `GET /healthz` only for Railway's local service health check.
- Alert on repeated `startup failed`, `database unavailable`, HTTP 429 bursts,
  uncaught errors and provider 5xx responses. Configure Sentry if external
  error alerting is required.
- A configured but unavailable Postgres database is logged and shown as
  `db: false` by `/healthz`, but it does not make the supported local-first app
  unready. Remove an accidental `DATABASE_URL` or restore the database before
  relying on its retained migration/reference schema.

## Data and backup caveats

- IndexedDB on the installed device is the primary store. Railway/Postgres is
  **not** a backup of inspections or photographs.
- Unlocking records a non-secret, origin-scoped activation marker. It permits
  the cached app and local IndexedDB to reopen when the session endpoint is
  unreachable; changing the server key does not remove it or local case data.
- Device loss, browser-data clearing, iOS storage eviction or uninstalling the
  PWA can remove unexported work. Request persistent storage in Settings and
  keep adequate free space, but do not treat that as a backup.
- Export each completed job to ZIP/report and confirm its cloud destination
  before deleting it from SiteSnap. Periodically test opening a restored ZIP.
- Back up Railway Postgres if it is configured, but understand that this only
  protects its reference/schema data.

## Release checklist

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npm test`
4. `npm run build`
5. `npx playwright-core install chromium` (once on the runner)
6. `npm run test:e2e:smoke`
7. Confirm no `.env`, credentials, `dist/`, test result files or customer data
   are staged.
8. Deploy the exact reviewed commit and verify the `commit` field from
   `/readyz` equals its full 40-character SHA over the public HTTPS URL.
9. Confirm DNS, Railway `PUBLIC_URL`, and the GitHub production environment URL
   all identify the same origin before enabling OAuth or AI provider secrets.

## Rollback

Use Railway **Deployments → previous successful deployment → Redeploy**. Keep
`SITESNAP_ACCESS_KEY` and `TOKEN_KEY` unchanged during an application rollback
unless incident containment requires rotation. The current migrations are
additive and have no automatic down migration; if a future release changes
schema incompatibly, restore the matching Postgres backup before redeploying
old code. Browser assets are content-hashed and the service worker uses a new
cache generation, so reopen the PWA online once after rollback and verify the
commit shown by `/readyz`.
