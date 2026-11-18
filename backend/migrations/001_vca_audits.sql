-- VCA-14: the audit store.
-- Run this once in the Supabase SQL editor of the PLATFORM project
-- (the one named by PLATFORM_SUPABASE_URL), NOT in a project that is tested.
-- It is safe to run again.

create table if not exists public.vca_audits (
  id          text primary key,
  status      text not null
              check (status in ('queued', 'running', 'completed', 'failed')),
  created_at  timestamptz not null,
  updated_at  timestamptz not null default now(),
  -- a random text that every write replaces. It is compared as plain text to
  -- tell whether somebody wrote the row in between (updated_at is not used for
  -- that: a timestamp does not survive being read and sent back unchanged).
  version     text not null default md5(random()::text || clock_timestamp()::text),
  -- which run may write this row while it is 'running'
  run_id      text,
  -- the audit as the backend keeps it (AuditRecord). It never holds a key.
  record      jsonb not null
);

-- For a table that was created before the version column existed. Rows that
-- are already there get a version of their own. Safe to run again.
alter table public.vca_audits
  add column if not exists version text not null
  default md5(random()::text || clock_timestamp()::text);

create index if not exists vca_audits_created_at_idx
  on public.vca_audits (created_at desc);
create index if not exists vca_audits_status_idx
  on public.vca_audits (status);

-- RLS on and NO policy: the public (anon) and logged-in (authenticated)
-- roles get nothing. Only the platform's service key can use this table.
alter table public.vca_audits enable row level security;
revoke all on public.vca_audits from anon, authenticated;

-- To undo (this deletes every stored audit):
--   drop table public.vca_audits;
