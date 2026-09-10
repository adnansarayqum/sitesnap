# End-to-end suites

Two Playwright scripts that drive the built app the way a surveyor would —
and then try to break it. They are deliberately adversarial: hostile
addresses, corrupt and oversized photos, twenty-photo bursts, reloads a
few milliseconds after a keystroke, offline reloads, a colleague trying to
overwrite someone else's case. Each scenario records PASS / FAIL / NOTE and
a failure never stops the run; results also land in `e2e-*-results.json`
under the temp directory.

They run against a real server and a real production build, not a dev
server — the service worker, CSP and static routes are part of what's
being tested.

## Local (single-user) mode

```sh
npm run build
CSP_CONNECT_EXTRA="http://localhost:3100" node server/index.js &   # the CRM-webhook scenario posts to a mock on :3100
node test/e2e/local.mjs                                            # BASE=http://localhost:3000 by default
```

## Accounts mode (Postgres)

Sign-in codes and invitation links are read back out of the server's log,
so start the server with its stdout captured and point `LOG` at it:

```sh
npm run build
PORT=3001 PUBLIC_URL=http://localhost:3001 DATABASE_URL=postgresql://... \
  CSP_CONNECT_EXTRA="http://localhost:3100" node server/index.js > /tmp/sitesnap-accounts.log 2>&1 &
BASE=http://localhost:3001 LOG=/tmp/sitesnap-accounts.log node test/e2e/accounts.mjs
```

Use a throwaway database: the suite creates users, a firm, invitations and
cases with unique per-run emails, and ends by deliberately tripping the
sign-in rate limit for its own IP.

## What the suites now also cover

- The capture screen: an issue raised while shooting, and the next photo
  filing into it (S7d); voice notes recorded from the capture bar.
- Run the local suite with `AI_MOCK=1` on the server to exercise the
  Findings tab end to end without a provider key — mock findings are
  labelled and never reach the report.

## Known limitations it reports as NOTE rather than FAIL

- The same case open in two browser tabs at once: the last tab to save
  wins, so a photo taken in the other tab can drop out of the room list
  (its file stays on the device). A phone runs one tab.
- Offline reload logs `ERR_INTERNET_DISCONNECTED` resource errors while the
  service worker serves the shell — noise, not a failure.

Chromium is launched with a fake camera and microphone
(`--use-fake-device-for-media-stream`), which is what lets the live camera,
the in-viewfinder rating strip and voice notes be exercised headlessly.
`playwright-core` (a dev dependency) drives it but does not download a
browser: point `CHROMIUM` at a Chromium/Chrome binary
(`CHROMIUM=/usr/bin/chromium node test/e2e/local.mjs`), or install one with
`npx playwright install chromium` and set `CHROMIUM` to the path it prints.
