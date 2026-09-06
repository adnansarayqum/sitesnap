# Going multi-user: architecture and what it commits you to

> **Status:** Option A is built, on Railway Postgres with the app's own auth
> rather than Supabase — see `docs/enterprise-setup.md`. The case register
> (metadata + thumbnails on the server) is the next stage.

SiteSnap today has no backend. It is a static page plus the browser's own
storage, and every upload goes to a webhook the user controls. That is why it
costs pennies to run and why you hold none of anyone's data.

Adding accounts and per-user file areas changes that completely. This document
is the recommended shape, the honest cost, and the obligations that arrive with
it.

## The decision that drives everything else

**Who holds the files?** Two viable answers, and they are not close in cost or
risk.

### Option A — the user's own cloud (BYO drive)

Each surveyor connects their own OneDrive or Google Drive. You store accounts
and inspection metadata; the photos never touch your infrastructure.

- You are not a data processor for the photos. The surveyor's existing
  agreements with their client already cover them.
- Storage costs you nothing and scales for free.
- Needs a Microsoft/Google OAuth app registration and per-user token refresh —
  the thing this project deliberately avoided at the start, now unavoidable.
- "Retrieve from any device" works, but through their drive, not your UI.

### Option B — your storage (true SaaS)

Files live in your bucket. The app shows a personal library, any device, no
external account needed.

- The product you described: personal area, upload, retrieve, delete.
- You become a **data processor** for photographs of tenants' homes taken for
  litigation. That means a DPA with every customer, a lawful basis, retention
  and deletion policies, breach notification within 72 hours, and a real answer
  to "where is it stored".
- Storage and egress cost money forever, on data you are contractually obliged
  to keep.

**Recommendation: build Option A first, with the data model ready for B.** It
gets you a sellable multi-user product without making you the custodian of
other people's evidence on day one. Move to B only when a customer asks for it
and will pay enough to fund the compliance work.

## Recommended stack

Supabase, for one reason: it gives auth, Postgres, object storage and
row-level security as one service, and RLS is what makes per-user isolation a
database guarantee rather than something you have to remember in every query.

| Need | Component |
|---|---|
| Sign-in | Supabase Auth (email magic link; add SSO later for firms) |
| Data | Supabase Postgres, RLS on every table |
| Files (Option B) | Supabase Storage, one bucket, path prefixed by user id |
| API | PostgREST via the client library; Edge Functions only where server-side secrets are needed |
| Hosting | Railway as now, for the static app |

Cloudflare (Workers + D1 + R2) is cheaper at high volume and worth revisiting
if storage ever dominates the bill. It is more assembly for the same result,
so it is the wrong first move.

## Data model

```
users            (id, email, created_at)            -- from auth
organisations    (id, name, plan)                   -- a firm; a solo user gets one
memberships      (user_id, org_id, role)            -- owner | surveyor | viewer
inspections      (id, org_id, created_by, address, postcode, ref, client,
                  occupier, solicitor, started_at, closed_at, status)
rooms            (id, inspection_id, order, name, condition, note)
photos           (id, room_id, no, filename, storage_path, taken_at, bytes)
voice_notes      (id, room_id, seconds, storage_path, transcript)
destinations     (id, org_id, kind, config)         -- their webhook or drive tokens
audit_log        (id, org_id, actor, action, target, at)
```

Two things worth doing from the start because retrofitting them is painful:

**Scope by organisation, not by user.** A solo surveyor is an organisation of
one. When a firm with six inspectors becomes a customer, nothing needs
rewriting.

**Keep the audit log.** For litigation evidence, "who uploaded this, when, and
has it been altered" is a question that will eventually be asked. Append-only,
never editable.

## Row-level security

Every table gets a policy of this shape, so isolation is enforced by the
database even if application code has a bug:

```sql
alter table inspections enable row level security;

create policy "members read their org's inspections"
  on inspections for select
  using (org_id in (select org_id from memberships where user_id = auth.uid()));

create policy "members write their org's inspections"
  on inspections for insert with check (
    org_id in (select org_id from memberships where user_id = auth.uid())
  );
```

Storage objects follow the same rule, keyed on a path prefix of
`{org_id}/{inspection_id}/…`, so a signed URL can never reach another
customer's folder.

## What changes in the app

Less than it sounds. The current storage layer is already isolated behind
`src/storage.js` — every read and write goes through it. Multi-user means:

1. An auth screen, and a session check before the property list.
2. A second implementation of the same storage interface that talks to
   Supabase instead of IndexedDB.
3. **Keep IndexedDB as the offline layer.** This is not optional for this
   product: the whole value is capturing a property with no signal. The local
   store stays the source of truth during an inspection and syncs afterwards.
   A cloud-only rewrite would break the one thing that makes the app worth
   using.
4. A sync queue with conflict rules — last-write-wins per field is fine here,
   since one inspection has one author in practice.

## Rough cost

| Users | Supabase | Storage (Option B, ~2 GB/user/yr) | Total |
|---|---|---|---|
| 1–5 | free tier | negligible | £0 |
| ~25 | Pro, ~£20/mo | ~50 GB, ~£1/mo | ~£21/mo |
| ~200 | Pro + usage, ~£60/mo | ~400 GB, ~£8/mo | ~£70/mo |

At £30/user/month, 25 users is roughly £750/month of revenue against ~£21 of
infrastructure. The cost that matters is not hosting — it is compliance,
support and the time to build it.

## What this actually commits you to

Worth being blunt, because these are the parts that sink small SaaS products
rather than the engineering:

- **A DPA with every customer**, and ICO registration as a data controller for
  your own user data.
- **Professional indemnity insurance**, given the product touches expert
  witness evidence.
- **Deletion that actually works**, including from backups, within a defined
  window.
- **Support**, forever. A surveyor who cannot upload at 4pm on a Friday will
  ring you.
- **An IP conversation with your friend before any of this.** The workbook, the
  Scott Schedule logic and the legal prompt are his work. Selling a product
  built on them into his own market is a partnership question, not a technical
  one, and it is much easier to settle now than after the first customer.

## Suggested sequence

1. **Now** — finish the single-user product and get him using it daily. A tool
   with one happy user who does this work for a living is worth more than a
   multi-tenant shell nobody has tested.
2. **Then** — accounts and sync (Option A). Two to three weeks. This is the
   point at which a second surveyor can use it without touching your Make
   account.
3. **Only on demand** — your own storage (Option B), with the compliance work
   funded by the customer asking for it.
