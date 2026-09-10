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
  // The staged pipeline: findings belong to an issue (defect cluster), carry
  // the verifier's gate, the evidence snapshot they were drafted against and
  // their approval/revision history; runs keep the whole audit record;
  // transcripts keep provenance and the surveyor's corrections beside the
  // machine's original.
  //
  // Legacy "edited" findings: under the old tab, Edit ended in a button
  // labelled "Save & approve" and the result was reportable. Those findings
  // were therefore explicitly approved by the surveyor, so they stay
  // reportable — migrated to `approved` with an approval record that says
  // how they got there. Nothing historical is deleted or demoted; only new
  // edits stop implying approval.
  {
    name: "0002-issues-pipeline",
    sql: `
      alter table findings drop constraint if exists findings_status_check;
      alter table findings add constraint findings_status_check
        check (status in ('draft', 'review_required', 'edited', 'approved', 'rejected', 'superseded'));
      alter table findings
        add column if not exists issue_id text,
        add column if not exists gate jsonb,
        add column if not exists verification jsonb,
        add column if not exists snapshot text,
        add column if not exists approval jsonb,
        add column if not exists revisions jsonb not null default '[]'::jsonb,
        add column if not exists pipeline_version text;
      update findings
         set status = 'approved',
             approval = jsonb_build_object('legacy', true, 'note', 'migrated from edited: approved through the pre-2.0 "Save & approve" action', 'at', now(), 'by', reviewed_by)
       where status = 'edited';
      create index if not exists findings_issue_idx on findings (case_id, issue_id, created_at desc);

      alter table drafting_runs
        add column if not exists issue_id text,
        add column if not exists pipeline jsonb,
        add column if not exists pipeline_version text,
        add column if not exists snapshot text;

      alter table transcripts
        add column if not exists model text,
        add column if not exists audio_hash text,
        add column if not exists corrected_text text,
        add column if not exists corrected_by uuid references users (id) on delete set null,
        add column if not exists corrected_at timestamptz,
        add column if not exists status text not null default 'complete',
        add column if not exists version int not null default 1;
    `,
  },
  // Pilot instrumentation: product events (what was done, when — ids and
  // counts, never inspection content) and structured feedback from
  // surveyors trying the product on real jobs.
  {
    name: "0003-product-events",
    sql: `
      create table if not exists product_events (
        id       bigserial primary key,
        org_id   uuid not null references orgs (id) on delete cascade,
        user_id  uuid references users (id) on delete set null,
        name     text not null,
        at       timestamptz not null default now(),
        props    jsonb not null default '{}'::jsonb
      );
      create index if not exists product_events_org_idx on product_events (org_id, at desc);
      create index if not exists product_events_user_idx on product_events (user_id, name, at desc);

      create table if not exists feedback (
        id           bigserial primary key,
        org_id       uuid not null references orgs (id) on delete cascade,
        user_id      uuid references users (id) on delete set null,
        kind         text not null,
        text         text not null default '',
        screen       text,
        case_id      text,
        finding_id   text,
        app_version  text,
        created_at   timestamptz not null default now()
      );
      create index if not exists feedback_org_idx on feedback (org_id, created_at desc);
    `,
  },
];
