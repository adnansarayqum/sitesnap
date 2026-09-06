# Running SiteSnap for firms (accounts mode)

SiteSnap runs in one of two modes, decided by whether `DATABASE_URL` is set:

| | local (default) | accounts |
|---|---|---|
| Who | one person, one phone | many firms, each with owners, admins and surveyors |
| Sign-in | none | email code, or Microsoft / Google |
| Cloud link | sealed blob on the phone (`docs/frictionless-cloud-link.md`) | per user, in the database — follows them across devices |
| Photos | the phone + their own drive | the phone + their own drive (unchanged: the server never holds a photo) |
| Needs | nothing | Railway Postgres, `TOKEN_KEY`, ideally Resend for email |

Nothing about the inspection workflow changes between modes. Accounts mode
adds the sign-in gate, the firm, the team page in Settings, and (next) the
firm's shared case register.

## 1. Provision

On Railway, in the SiteSnap project:

1. **+ New → Database → PostgreSQL.** Railway creates it and exposes
   `DATABASE_URL`; on the SiteSnap service add a variable reference to it
   (Variables → *Add reference* → the Postgres `DATABASE_URL`).
2. Set the remaining variables on the SiteSnap service:

| variable | required | value |
|---|---|---|
| `DATABASE_URL` | yes | reference to the Railway Postgres |
| `TOKEN_KEY` | yes | `openssl rand -hex 32`. Seals every stored refresh token and signs pairing state. **Rotating it disconnects every user's drive** (they reconnect in Settings; nothing else is lost). |
| `RESEND_API_KEY` | strongly | from resend.com — sends sign-in codes and invitations. Without it, codes are written to the server log and invitations must be passed on by hand (the admin sees the link). |
| `EMAIL_FROM` | with Resend | e.g. `SiteSnap <sitesnap@yourdomain.co.uk>` — the domain must be verified in Resend |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | optional | enables *Continue with Microsoft* and OneDrive links — `docs/direct-cloud-link-setup.md` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | enables *Continue with Google* and Drive links |
| `PUBLIC_URL` | optional | only if Railway's forwarded host isn't the public one |

3. Redeploy. The server applies `server/schema.sql` on boot (idempotent) and
   any entries in `server/migrations.js`. `GET /healthz` reports
   `{"ok":true,"mode":"accounts","db":true}` when it's up.

## 2. First firm

Open the app, sign in with your email (the code arrives by email, or is in
the Railway log if email isn't set up yet), and **Create firm**. You're its
owner. Settings → **Invite someone** sends an invitation, and also shows the
link so you can hand it over on WhatsApp. The invitee opens the link on the
phone they'll inspect with, signs in with the invited address (or *Continue
with Microsoft/Google* on that address), and lands in the firm.

## Roles

| | surveyor | admin | owner |
|---|---|---|---|
| shoot, file and export cases | ✓ | ✓ | ✓ |
| invite, remove, change roles | | ✓ (not owners) | ✓ |
| rename the firm | | ✓ | ✓ |
| make or unmake an owner | | | ✓ |

A firm always keeps at least one owner. A person can belong to several
firms and switches between them in Settings.

## What the server holds, and what it doesn't

- **Holds:** accounts (email, name), firms and memberships, invitations,
  sessions (as hashes), each user's *sealed* drive refresh token, an audit
  log of team changes, and — once the case register ships — case metadata
  and thumbnails.
- **Never holds:** full-size photos or voice notes. Those go phone → the
  surveyor's own OneDrive/Drive, as in local mode. This is what keeps you
  out of data-processor territory for the photographs themselves
  (`docs/multi-user-architecture.md`, Option A).
- Sign-in codes are stored hashed, expire in 10 minutes, and lock after 5
  wrong tries. Sessions are httpOnly cookies, 90 days sliding.
- Every mutating API call must be JSON and same-origin (`SameSite=Lax`
  cookies plus a content-type check), so a hostile page can't act as a
  signed-in user.

## Phones shared between people

Local data (cases, photos) is kept per user on the phone: signing out
hides it, signing back in shows it. Nothing is deleted by signing out. A
second person signing in on the same phone starts with an empty register.

## Backups and recovery

Railway Postgres has daily backups on paid plans; take a `pg_dump` before
any deploy that touches `server/migrations.js`. Losing the database loses
accounts, firms and links — not photos, which are on phones and in drives.
Losing `TOKEN_KEY` loses only the drive links.

## Where this lives

`server/index.js` (routes), `server/auth.js` (sessions, codes, guards),
`server/db.js` + `schema.sql` + `migrations.js`, `server/email.js`;
`src/auth.js` (client calls), `src/screens/SignIn.jsx`, `Org.jsx`,
`Team.jsx`, and the account card in `Settings.jsx`. Storage on the phone is
namespaced per user in `src/storage.js`.
