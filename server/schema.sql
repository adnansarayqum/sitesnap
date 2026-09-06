-- SiteSnap accounts schema. Applied on boot by server/db.js; every
-- statement is idempotent so a redeploy is safe. Later changes go in as
-- numbered entries in server/migrations.js, never by editing this file.

create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
create unique index if not exists users_email_idx on users (lower(email));

create table if not exists memberships (
  org_id      uuid not null references orgs (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  role        text not null check (role in ('owner', 'admin', 'surveyor')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs (id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('admin', 'surveyor')),
  token_hash   text not null unique,
  invited_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_at  timestamptz
);
create index if not exists invites_org_idx on invites (org_id) where accepted_at is null;

-- one-time sign-in codes sent by email; only the hash is kept
create table if not exists login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists login_codes_email_idx on login_codes (lower(email), created_at desc);

-- the id is the sha256 of the cookie value, so a database read never
-- yields a usable session token
create table if not exists sessions (
  id            text primary key,
  user_id       uuid not null references users (id) on delete cascade,
  org_id        uuid references orgs (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  user_agent    text
);
create index if not exists sessions_user_idx on sessions (user_id);

-- a user's OneDrive / Google Drive connection: the refresh token, sealed
-- with TOKEN_KEY — follows the user across their devices
create table if not exists cloud_links (
  user_id            uuid not null references users (id) on delete cascade,
  provider           text not null check (provider in ('onedrive', 'google')),
  refresh_token_enc  text not null,
  account            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (user_id, provider)
);

-- per-firm case numbering, assigned by the server on first sync so two
-- surveyors starting properties at once never share a number
create table if not exists org_counters (
  org_id        uuid primary key references orgs (id) on delete cascade,
  next_case_no  int not null default 1
);

-- the firm's case register: everything about a case except the full-size
-- photos, which stay on the phone and in the surveyor's own drive
create table if not exists cases (
  id          text primary key,
  org_id      uuid not null references orgs (id) on delete cascade,
  created_by  uuid references users (id) on delete set null,
  case_no     int,
  address     text not null,
  postcode    text,
  status      text not null default 'open' check (status in ('open', 'closed')),
  started_at  timestamptz,
  closed_at   timestamptz,
  updated_at  timestamptz not null default now(),
  doc         jsonb not null default '{}'::jsonb
);
create index if not exists cases_org_idx on cases (org_id, status, updated_at desc);
create unique index if not exists cases_org_no_idx on cases (org_id, case_no) where case_no is not null;

create table if not exists photos (
  id          text primary key,
  case_id     text not null references cases (id) on delete cascade,
  room_id     text,
  no          int,
  caption     text,
  thumb       bytea,
  created_at  timestamptz not null default now()
);
create index if not exists photos_case_idx on photos (case_id);

create table if not exists audit_log (
  id          bigserial primary key,
  org_id      uuid,
  user_id     uuid,
  action      text not null,
  target      text,
  detail      jsonb,
  at          timestamptz not null default now()
);
create index if not exists audit_org_idx on audit_log (org_id, at desc);
