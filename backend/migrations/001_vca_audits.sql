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
  -- which run may write this row while it is 'running'
  run_id      text,
  -- the audit as the backend keeps it (AuditRecord). It never holds a key.
  record      jsonb not null
);

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
