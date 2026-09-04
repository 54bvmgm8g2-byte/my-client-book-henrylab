-- Cover notice audit foreign keys used by account cleanup and administration.
create index if not exists service_notices_created_by_idx
  on public.service_notices(created_by);

create index if not exists service_notices_stopped_by_idx
  on public.service_notices(stopped_by)
  where stopped_by is not null;
