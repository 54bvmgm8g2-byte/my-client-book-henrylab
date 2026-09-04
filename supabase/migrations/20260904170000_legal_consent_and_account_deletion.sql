create table if not exists public.legal_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  terms_accepted_at timestamptz not null default now(),
  privacy_accepted_at timestamptz not null default now()
);

alter table public.legal_consents enable row level security;

revoke all on table public.legal_consents from public, anon;
grant select on table public.legal_consents to authenticated;

drop policy if exists legal_consents_select_own on public.legal_consents;
create policy legal_consents_select_own
on public.legal_consents
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.app_entitlements (user_id, status, source)
  values (new.id, 'pending', 'signup')
  on conflict (user_id) do nothing;

  if new.raw_user_meta_data->>'terms_accepted' = 'true'
     and new.raw_user_meta_data->>'privacy_accepted' = 'true' then
    insert into public.legal_consents (
      user_id, terms_version, privacy_version, terms_accepted_at, privacy_accepted_at
    ) values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data->>'legal_version', ''), '2026-09-04'),
      coalesce(nullif(new.raw_user_meta_data->>'legal_version', ''), '2026-09-04'),
      now(),
      now()
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if public.is_app_owner() then
    raise exception 'owner account cannot be deleted' using errcode = '42501';
  end if;

  delete from auth.sessions where user_id = v_user_id;
  delete from auth.users where id = v_user_id;

  if not found then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

