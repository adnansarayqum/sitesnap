// Ordered, one-off schema changes made after schema.sql first shipped.
// Append only; never edit an entry that has been deployed. Each runs once,
// in a transaction, and is recorded in schema_migrations.
export const MIGRATIONS = [
  // Draft findings: what the AI produced for a room, what the surveyor did
  // with it. One row per finding per drafting run, so an eval can compare a
  // run's output to the reviewed result and a case's history is auditable.
  {
    name: "0001-findings",
    sql: `
      create table if not exists findings (
        id            uuid primary key default gen_random_uuid(),
        case_id       text not null references cases (id) on delete cascade,
        org_id        uuid not null references orgs (id) on delete cascade,
        room_id       text not null,
        room_name     text not null,
        run_id        uuid not null,
        seq           int not null,
        status        text not null default 'draft' check (status in ('draft', 'approved', 'edited', 'rejected')),
        finding       jsonb not null,
        reviewed      jsonb,
        reviewed_by   uuid references users (id) on delete set null,
        reviewed_at   timestamptz,
        model         text,
        reference     text,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      );
      create index if not exists findings_case_idx on findings (case_id, room_id, created_at desc);

      create table if not exists drafting_runs (
        id            uuid primary key default gen_random_uuid(),
        case_id       text not null references cases (id) on delete cascade,
        org_id        uuid not null references orgs (id) on delete cascade,
        room_id       text not null,
        requested_by  uuid references users (id) on delete set null,
        model         text,
        reference     text,
        served_by     text,
        usage         jsonb,
        room_summary  text,
        evidence_gaps jsonb,
        photos        int not null default 0,
        transcripts   int not null default 0,
        created_at    timestamptz not null default now()
      );
      create index if not exists drafting_runs_case_idx on drafting_runs (case_id, created_at desc);

      create table if not exists transcripts (
        memo_id       text primary key,
        case_id       text not null references cases (id) on delete cascade,
        org_id        uuid not null references orgs (id) on delete cascade,
        room_id       text not null,
        text          text not null,
        provider      text,
        created_at    timestamptz not null default now()
      );
      create index if not exists transcripts_case_idx on transcripts (case_id, room_id);
    `,
  },
];
