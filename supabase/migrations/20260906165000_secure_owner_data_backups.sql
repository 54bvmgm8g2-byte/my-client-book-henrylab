-- Internal recovery snapshots are never exposed to client roles.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.owner_data_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  reason text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.owner_data_backups enable row level security;

-- Intentionally no client-facing policies. Only privileged server/database
-- operations may access recovery snapshots.
revoke all privileges on table private.owner_data_backups
  from public, anon, authenticated;
