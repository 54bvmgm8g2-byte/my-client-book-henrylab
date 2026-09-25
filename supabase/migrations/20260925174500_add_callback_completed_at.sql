alter table public.visits
  add column if not exists callback_completed_at timestamptz;

create index if not exists visits_user_callback_completed_at_idx
  on public.visits (user_id, callback_completed_at desc)
  where callback_completed_at is not null;
