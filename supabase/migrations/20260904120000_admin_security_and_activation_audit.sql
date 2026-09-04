-- MY CLIENT BOOK / HenryLAB admin hardening and activation audit
alter table public.app_entitlements
  add column if not exists activated_at timestamptz,
  add column if not exists activation_note text,
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists status_changed_by uuid references auth.users(id) on delete set null;

update public.app_entitlements
set activated_at = coalesce(activated_at, case when status='active' then updated_at end),
    status_changed_at = coalesce(status_changed_at, updated_at);

create or replace function public.admin_set_entitlement(p_user_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_old_source text;
begin
  if not public.is_app_owner() then raise exception '관리자 권한이 없습니다.'; end if;
  if p_status not in ('active','pending','revoked','expired') then raise exception '허용되지 않은 상태입니다.'; end if;
  select status,source into v_old_status,v_old_source from public.app_entitlements where user_id=p_user_id;
  if v_old_source='owner' then raise exception '관리자(owner) 계정 상태는 변경할 수 없습니다.'; end if;

  insert into public.app_entitlements(user_id,status,source,expires_at,activated_at,activation_note,status_changed_at,status_changed_by)
  values(
    p_user_id,
    p_status,
    case when p_status='active' then 'admin_grant' else coalesce(v_old_source,'admin') end,
    null,
    case when p_status='active' then now() else null end,
    nullif(trim(coalesce(p_note,'')),''),
    now(),
    auth.uid()
  )
  on conflict(user_id) do update
    set status=excluded.status,
        source=case when excluded.status='active' then 'admin_grant' else public.app_entitlements.source end,
        expires_at=null,
        activated_at=case when excluded.status='active' then now() else public.app_entitlements.activated_at end,
        activation_note=excluded.activation_note,
        status_changed_at=now(),
        status_changed_by=auth.uid(),
        updated_at=now();

  perform public.log_admin_action('entitlement_'||p_status,'user',p_user_id::text,
    jsonb_build_object('from',coalesce(v_old_status,'none'),'to',p_status,'method',case when p_status='active' then 'admin_grant' else coalesce(v_old_source,'admin') end,'note',coalesce(p_note,'')));
  return jsonb_build_object('success',true,'status',p_status,'changed_at',now());
end;
$$;

drop function if exists public.admin_list_users(text);
create function public.admin_list_users(p_search text default '')
returns table(
  user_id uuid, display_name text, email text, joined_at timestamptz,
  last_seen_at timestamptz, last_app_version text, entitlement_status text,
  entitlement_source text, expires_at timestamptz, activated_at timestamptz,
  activation_note text, status_changed_at timestamptz,
  activation_label text, activation_redeemed_at timestamptz,
  customer_count bigint, visit_count bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
select u.id,
       coalesce(p.display_name,split_part(u.email,'@',1)),
       u.email,
       u.created_at,
       a.last_seen_at,
       a.last_app_version,
       coalesce(e.status,'pending'),
       coalesce(e.source,'signup'),
       e.expires_at,
       e.activated_at,
       e.activation_note,
       e.status_changed_at,
       ac.label,
       ac.redeemed_at,
       (select count(*) from public.customers c where c.user_id=u.id),
       (select count(*) from public.visits v where v.user_id=u.id)
from auth.users u
left join public.app_profiles p on p.user_id=u.id
left join public.app_entitlements e on e.user_id=u.id
left join public.user_activity a on a.user_id=u.id
left join lateral (
  select label,redeemed_at from public.activation_codes x
  where x.redeemed_by=u.id
  order by redeemed_at desc nulls last limit 1
) ac on true
where public.is_app_owner()
  and (coalesce(trim(p_search),'')='' or coalesce(p.display_name,'') ilike '%'||trim(p_search)||'%' or coalesce(u.email,'') ilike '%'||trim(p_search)||'%')
order by u.created_at desc;
$$;

-- Restrict ordinary data policies to authenticated users only.
drop policy if exists customers_select_own on public.customers;
drop policy if exists customers_insert_own on public.customers;
drop policy if exists customers_update_own on public.customers;
drop policy if exists customers_delete_own on public.customers;
create policy customers_select_own on public.customers for select to authenticated using ((select auth.uid())=user_id);
create policy customers_insert_own on public.customers for insert to authenticated with check ((select auth.uid())=user_id);
create policy customers_update_own on public.customers for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy customers_delete_own on public.customers for delete to authenticated using ((select auth.uid())=user_id);

drop policy if exists visits_select_own on public.visits;
drop policy if exists visits_insert_own on public.visits;
drop policy if exists visits_update_own on public.visits;
drop policy if exists visits_delete_own on public.visits;
create policy visits_select_own on public.visits for select to authenticated using ((select auth.uid())=user_id);
create policy visits_insert_own on public.visits for insert to authenticated with check ((select auth.uid())=user_id);
create policy visits_update_own on public.visits for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy visits_delete_own on public.visits for delete to authenticated using ((select auth.uid())=user_id);

drop policy if exists settings_select_own on public.user_settings;
drop policy if exists settings_insert_own on public.user_settings;
drop policy if exists settings_update_own on public.user_settings;
drop policy if exists settings_delete_own on public.user_settings;
create policy settings_select_own on public.user_settings for select to authenticated using ((select auth.uid())=user_id);
create policy settings_insert_own on public.user_settings for insert to authenticated with check ((select auth.uid())=user_id);
create policy settings_update_own on public.user_settings for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy settings_delete_own on public.user_settings for delete to authenticated using ((select auth.uid())=user_id);

drop policy if exists profiles_select_own on public.app_profiles;
drop policy if exists profiles_insert_own on public.app_profiles;
drop policy if exists profiles_update_own on public.app_profiles;
drop policy if exists profiles_delete_own on public.app_profiles;
create policy profiles_select_own on public.app_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy profiles_insert_own on public.app_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy profiles_update_own on public.app_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy profiles_delete_own on public.app_profiles for delete to authenticated using ((select auth.uid())=user_id);

drop policy if exists entitlements_select_own on public.app_entitlements;
create policy entitlements_select_own on public.app_entitlements for select to authenticated using ((select auth.uid())=user_id);

-- The browser never needs anonymous database access.
revoke all on all tables in schema public from anon;
grant select,insert,update,delete on public.customers,public.visits,public.daily_notes,public.user_settings,public.app_profiles,public.support_inquiries to authenticated;
grant select on public.app_entitlements to authenticated;

-- SECURITY DEFINER functions are callable only through the explicitly listed authenticated RPC surface.
revoke all on all functions in schema public from public, anon;
revoke execute on function public.log_admin_action(text,text,text,jsonb) from authenticated;
grant execute on function public.is_app_owner() to authenticated;
grant execute on function public.redeem_activation_code(text) to authenticated;
grant execute on function public.submit_support_inquiry(text,text,text) to authenticated;
grant execute on function public.touch_user_activity(text) to authenticated;
grant execute on function public.get_system_notice() to authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_generate_activation_codes(integer) to authenticated;
grant execute on function public.admin_get_system_config() to authenticated;
grant execute on function public.admin_list_activation_codes() to authenticated;
grant execute on function public.admin_list_audit_logs(integer) to authenticated;
grant execute on function public.admin_list_customers(uuid,text,integer) to authenticated;
grant execute on function public.admin_list_inquiries() to authenticated;
grant execute on function public.admin_list_users(text) to authenticated;
grant execute on function public.admin_list_visits(uuid,integer) to authenticated;
grant execute on function public.admin_set_activation_code_active(uuid,boolean,text) to authenticated;
grant execute on function public.admin_set_entitlement(uuid,text,text) to authenticated;
grant execute on function public.admin_update_inquiry(uuid,text,text) to authenticated;
grant execute on function public.admin_update_system_config(boolean,text,text,boolean) to authenticated;
