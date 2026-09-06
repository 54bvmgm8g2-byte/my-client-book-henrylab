-- MY CLIENT BOOK v2.15: 7-day trial, annual entitlements and server-side write limits.

alter table public.app_entitlements
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz;

-- Previously redeemed KMONG codes were permanent. Convert those entitlements
-- to one year from the original redemption/activation time without changing codes.
update public.app_entitlements e
set expires_at = coalesce(
      (select max(ac.redeemed_at) from public.activation_codes ac where ac.redeemed_by=e.user_id),
      e.activated_at,e.updated_at,e.created_at,now()
    ) + interval '1 year',
    updated_at = now()
where e.source='kmong_code' and e.expires_at is null;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.app_can_write(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_entitlements e
    where e.user_id = p_user_id
      and (
        (e.status in ('active','trial') and (e.expires_at is null or e.expires_at > now()))
        or (e.status = 'active' and e.source = 'owner')
      )
  );
$$;

create or replace function private.app_can_insert_customer(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.app_can_write(p_user_id)
    and (
      not exists (
        select 1 from public.app_entitlements e
        where e.user_id = p_user_id and e.status = 'trial' and e.source = 'trial'
      )
      or (select count(*) from public.customers c where c.user_id = p_user_id) < 50
    );
$$;

create or replace function private.app_can_insert_visit(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.app_can_write(p_user_id)
    and (
      not exists (
        select 1 from public.app_entitlements e
        where e.user_id = p_user_id and e.status = 'trial' and e.source = 'trial'
      )
      or (select count(*) from public.visits v where v.user_id = p_user_id) < 100
    );
$$;

revoke all on function private.app_can_write(uuid) from public, anon;
revoke all on function private.app_can_insert_customer(uuid) from public, anon;
revoke all on function private.app_can_insert_visit(uuid) from public, anon;
grant execute on function private.app_can_write(uuid) to authenticated;
grant execute on function private.app_can_insert_customer(uuid) to authenticated;
grant execute on function private.app_can_insert_visit(uuid) to authenticated;

create or replace function private.enforce_trial_row_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_trial boolean;
  v_count bigint;
  v_limit integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('mcb-trial-limit:'||new.user_id::text,0));
  select exists(
    select 1 from public.app_entitlements e
    where e.user_id=new.user_id and e.status='trial' and e.source='trial' and e.expires_at>now()
  ) into v_is_trial;
  if not v_is_trial then return new; end if;
  if tg_table_name='customers' then
    select count(*) into v_count from public.customers c where c.user_id=new.user_id;
    v_limit:=50;
  elsif tg_table_name='visits' then
    select count(*) into v_count from public.visits v where v.user_id=new.user_id;
    v_limit:=100;
  else
    return new;
  end if;
  if v_count>=v_limit then raise exception '무료체험 등록 한도에 도달했습니다.' using errcode='check_violation'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_trial_row_limit() from public,anon,authenticated;
drop trigger if exists customers_enforce_trial_limit on public.customers;
create trigger customers_enforce_trial_limit before insert on public.customers for each row execute function private.enforce_trial_row_limit();
drop trigger if exists visits_enforce_trial_limit on public.visits;
create trigger visits_enforce_trial_limit before insert on public.visits for each row execute function private.enforce_trial_row_limit();

drop policy if exists customers_insert_own on public.customers;
drop policy if exists customers_update_own on public.customers;
drop policy if exists customers_delete_own on public.customers;
create policy customers_insert_own on public.customers for insert to authenticated
with check ((select auth.uid()) = user_id and private.app_can_insert_customer((select auth.uid())));
create policy customers_update_own on public.customers for update to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())))
with check ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));
create policy customers_delete_own on public.customers for delete to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));

drop policy if exists visits_insert_own on public.visits;
drop policy if exists visits_update_own on public.visits;
drop policy if exists visits_delete_own on public.visits;
create policy visits_insert_own on public.visits for insert to authenticated
with check ((select auth.uid()) = user_id and private.app_can_insert_visit((select auth.uid())));
create policy visits_update_own on public.visits for update to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())))
with check ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));
create policy visits_delete_own on public.visits for delete to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));

drop policy if exists daily_notes_insert_own on public.daily_notes;
drop policy if exists daily_notes_update_own on public.daily_notes;
drop policy if exists daily_notes_delete_own on public.daily_notes;
create policy daily_notes_insert_own on public.daily_notes for insert to authenticated
with check ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));
create policy daily_notes_update_own on public.daily_notes for update to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())))
with check ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));
create policy daily_notes_delete_own on public.daily_notes for delete to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));

drop policy if exists settings_insert_own on public.user_settings;
drop policy if exists settings_update_own on public.user_settings;
drop policy if exists settings_delete_own on public.user_settings;
create policy settings_insert_own on public.user_settings for insert to authenticated
with check ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));
create policy settings_update_own on public.user_settings for update to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())))
with check ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));
create policy settings_delete_own on public.user_settings for delete to authenticated
using ((select auth.uid()) = user_id and private.app_can_write((select auth.uid())));

drop policy if exists daily_notes_select_own on public.daily_notes;
create policy daily_notes_select_own on public.daily_notes for select to authenticated
using ((select auth.uid()) = user_id);

create index if not exists activation_codes_redeemed_by_idx on public.activation_codes(redeemed_by);
create index if not exists admin_audit_logs_actor_user_id_idx on public.admin_audit_logs(actor_user_id);
create index if not exists app_entitlements_status_changed_by_idx on public.app_entitlements(status_changed_by);
create index if not exists app_system_config_updated_by_idx on public.app_system_config(updated_by);
create index if not exists visits_customer_user_idx on public.visits(customer_id,user_id);
drop index if exists public.activation_codes_code_hash_uidx;

create or replace function public.get_my_entitlement()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.app_entitlements%rowtype;
  v_now timestamptz := now();
  v_email_confirmed timestamptz;
  v_customers bigint := 0;
  v_visits bigint := 0;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  select email_confirmed_at into v_email_confirmed from auth.users where id = v_uid;
  select * into v_ent from public.app_entitlements where user_id = v_uid for update;

  if not found then
    insert into public.app_entitlements(user_id,status,source)
    values(v_uid,'pending','signup') returning * into v_ent;
  end if;

  if v_ent.status = 'pending' and v_ent.source = 'signup' and v_email_confirmed is not null then
    update public.app_entitlements
    set status = 'trial', source = 'trial',
        trial_started_at = coalesce(trial_started_at,v_now),
        trial_ends_at = coalesce(trial_ends_at,v_now + interval '7 days'),
        activated_at = coalesce(activated_at,v_now),
        expires_at = coalesce(trial_ends_at,v_now + interval '7 days'),
        status_changed_at = v_now, updated_at = v_now
    where user_id = v_uid returning * into v_ent;
  elsif v_ent.status in ('active','trial') and v_ent.source <> 'owner'
        and v_ent.expires_at is not null and v_ent.expires_at <= v_now then
    update public.app_entitlements
    set status = 'expired', status_changed_at = v_now, updated_at = v_now
    where user_id = v_uid returning * into v_ent;
  end if;

  select count(*) into v_customers from public.customers where user_id = v_uid;
  select count(*) into v_visits from public.visits where user_id = v_uid;

  return jsonb_build_object(
    'status',v_ent.status,
    'source',v_ent.source,
    'expires_at',v_ent.expires_at,
    'trial_started_at',v_ent.trial_started_at,
    'trial_ends_at',v_ent.trial_ends_at,
    'server_now',v_now,
    'can_read',v_ent.status in ('active','trial','expired'),
    'can_write',private.app_can_write(v_uid),
    'days_remaining',case when v_ent.expires_at is null then null else greatest(0,ceil(extract(epoch from (v_ent.expires_at-v_now))/86400.0))::int end,
    'customer_limit',case when v_ent.status='trial' and v_ent.source='trial' then 50 else null end,
    'visit_limit',case when v_ent.status='trial' and v_ent.source='trial' then 100 else null end,
    'customer_count',v_customers,
    'visit_count',v_visits
  );
end;
$$;

create or replace function public.redeem_activation_code(p_code text)
returns table(success boolean,message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code_id uuid;
  v_ent public.app_entitlements%rowtype;
  v_base timestamptz;
  v_new_expiry timestamptz;
begin
  if v_uid is null then return query select false,'로그인이 필요합니다.'; return; end if;

  select * into v_ent from public.app_entitlements where user_id=v_uid for update;
  if v_ent.source='owner' then return query select true,'Owner 계정은 영구 이용 중입니다.'; return; end if;
  if v_ent.status='revoked' then return query select false,'현재 사용이 중지된 계정입니다. 문의해주세요.'; return; end if;

  select id into v_code_id
  from public.activation_codes
  where code_hash=extensions.digest(upper(trim(p_code)),'sha256')
    and is_active=true and redeemed_at is null
    and (expires_at is null or expires_at>now())
  for update skip locked;

  if v_code_id is null then
    return query select false,'유효하지 않거나 이미 사용된 이용코드입니다.'; return;
  end if;

  v_base := greatest(now(),coalesce(v_ent.expires_at,now()));
  v_new_expiry := v_base + interval '1 year';

  update public.activation_codes set redeemed_at=now(),redeemed_by=v_uid where id=v_code_id;
  insert into public.app_entitlements(user_id,status,source,expires_at,activated_at,status_changed_at)
  values(v_uid,'active','kmong_code',v_new_expiry,now(),now())
  on conflict(user_id) do update
    set status='active',source='kmong_code',expires_at=v_new_expiry,
        activated_at=coalesce(public.app_entitlements.activated_at,now()),
        status_changed_at=now(),updated_at=now();

  return query select true,'1년 이용권이 활성화되었습니다. 만료일: '||to_char(v_new_expiry at time zone 'Asia/Seoul','YYYY.MM.DD');
end;
$$;

drop function if exists public.admin_set_entitlement(uuid,text,text);
create function public.admin_set_entitlement(p_user_id uuid,p_status text,p_note text default null,p_duration_days integer default 365)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_status text;
  v_old_source text;
  v_expiry timestamptz;
begin
  if not public.is_app_owner() then raise exception '관리자 권한이 없습니다.'; end if;
  if p_status not in ('active','pending','revoked','expired') then raise exception '허용되지 않은 상태입니다.'; end if;
  if p_status='active' and p_duration_days is not null and p_duration_days not between 1 and 3650 then raise exception '활성 기간이 올바르지 않습니다.'; end if;
  select status,source into v_old_status,v_old_source from public.app_entitlements where user_id=p_user_id for update;
  if v_old_source='owner' then raise exception '관리자(owner) 계정 상태는 변경할 수 없습니다.'; end if;

  v_expiry := case when p_status='active' and p_duration_days is not null then now() + make_interval(days=>p_duration_days) else null end;
  insert into public.app_entitlements(user_id,status,source,expires_at,activated_at,activation_note,status_changed_at,status_changed_by)
  values(p_user_id,p_status,case when p_status='active' then 'admin_grant' else coalesce(v_old_source,'admin') end,
         v_expiry,case when p_status='active' then now() else null end,nullif(trim(coalesce(p_note,'')),''),now(),auth.uid())
  on conflict(user_id) do update
    set status=excluded.status,
        source=case when excluded.status='active' then 'admin_grant' else public.app_entitlements.source end,
        expires_at=case when excluded.status='active' then excluded.expires_at else public.app_entitlements.expires_at end,
        activated_at=case when excluded.status='active' then now() else public.app_entitlements.activated_at end,
        activation_note=excluded.activation_note,status_changed_at=now(),status_changed_by=auth.uid(),updated_at=now();

  perform public.log_admin_action('entitlement_'||p_status,'user',p_user_id::text,
    jsonb_build_object('from',coalesce(v_old_status,'none'),'to',p_status,
      'method',case when p_status='active' then 'admin_grant' else coalesce(v_old_source,'admin') end,
      'duration_days',p_duration_days,'expires_at',v_expiry,'note',coalesce(p_note,'')));
  return jsonb_build_object('success',true,'status',p_status,'expires_at',v_expiry,'changed_at',now());
end;
$$;

drop function if exists public.admin_list_users(text);
create function public.admin_list_users(p_search text default '')
returns table(
  user_id uuid,display_name text,email text,joined_at timestamptz,last_seen_at timestamptz,last_app_version text,
  entitlement_status text,entitlement_source text,expires_at timestamptz,activated_at timestamptz,
  trial_started_at timestamptz,trial_ends_at timestamptz,days_remaining integer,
  activation_note text,status_changed_at timestamptz,activation_label text,activation_redeemed_at timestamptz,
  customer_count bigint,visit_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
select u.id,coalesce(p.display_name,split_part(u.email,'@',1)),u.email,u.created_at,a.last_seen_at,a.last_app_version,
       case when e.status in ('active','trial') and e.source<>'owner' and e.expires_at<=now() then 'expired' else coalesce(e.status,'pending') end,
       coalesce(e.source,'signup'),e.expires_at,e.activated_at,e.trial_started_at,e.trial_ends_at,
       case when e.expires_at is null then null else greatest(0,ceil(extract(epoch from (e.expires_at-now()))/86400.0))::int end,
       e.activation_note,e.status_changed_at,ac.label,ac.redeemed_at,
       (select count(*) from public.customers c where c.user_id=u.id),
       (select count(*) from public.visits v where v.user_id=u.id)
from auth.users u
left join public.app_profiles p on p.user_id=u.id
left join public.app_entitlements e on e.user_id=u.id
left join public.user_activity a on a.user_id=u.id
left join lateral (
  select x.label,x.redeemed_at from public.activation_codes x where x.redeemed_by=u.id
  order by x.redeemed_at desc nulls last limit 1
) ac on true
where public.is_app_owner()
  and (coalesce(trim(p_search),'')='' or coalesce(p.display_name,'') ilike '%'||trim(p_search)||'%' or coalesce(u.email,'') ilike '%'||trim(p_search)||'%')
order by u.created_at desc;
$$;

create or replace function public.admin_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
select case when public.is_app_owner() then jsonb_build_object(
  'total_users',(select count(*) from auth.users),
  'active_users',(select count(*) from public.app_entitlements where status='active' and (expires_at is null or expires_at>now())),
  'trial_users',(select count(*) from public.app_entitlements where status='trial' and expires_at>now()),
  'trial_ended_users',(select count(*) from public.app_entitlements where source='trial' and (status='expired' or expires_at<=now())),
  'converted_users',(select count(*) from public.app_entitlements where source in ('kmong_code','admin_grant') and status='active' and (expires_at is null or expires_at>now())),
  'inactive_users',(select count(*) from public.app_entitlements where status='pending'),
  'revoked_users',(select count(*) from public.app_entitlements where status='revoked'),
  'expired_users',(select count(*) from public.app_entitlements where status='expired' or (status in ('active','trial') and expires_at is not null and expires_at<=now())),
  'today_signups',(select count(*) from auth.users where timezone('Asia/Seoul',created_at)::date=timezone('Asia/Seoul',now())::date),
  'month_signups',(select count(*) from auth.users where date_trunc('month',timezone('Asia/Seoul',created_at))=date_trunc('month',timezone('Asia/Seoul',now()))),
  'customers',(select count(*) from public.customers),'visits',(select count(*) from public.visits),
  'inquiries',(select count(*) from public.support_inquiries),'open_inquiries',(select count(*) from public.support_inquiries where status in ('새 문의','확인 중')),
  'codes_total',(select count(*) from public.activation_codes),'codes_unused',(select count(*) from public.activation_codes where is_active=true and redeemed_at is null and (expires_at is null or expires_at>now())),
  'codes_redeemed',(select count(*) from public.activation_codes where redeemed_at is not null)
) else null end;
$$;

drop function if exists public.admin_list_activation_codes();
create function public.admin_list_activation_codes()
returns table(
  code_id uuid,label text,is_active boolean,expires_at timestamptz,redeemed_at timestamptz,redeemed_by uuid,
  redeemed_name text,redeemed_email text,created_at timestamptz,entitlement_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
select ac.id,ac.label,ac.is_active,ac.expires_at,ac.redeemed_at,ac.redeemed_by,
       coalesce(p.display_name,split_part(u.email,'@',1)),u.email,ac.created_at,e.expires_at
from public.activation_codes ac
left join auth.users u on u.id=ac.redeemed_by
left join public.app_profiles p on p.user_id=ac.redeemed_by
left join public.app_entitlements e on e.user_id=ac.redeemed_by
where public.is_app_owner()
order by ac.created_at,ac.label;
$$;

revoke execute on function public.get_my_entitlement() from public,anon;
revoke execute on function public.redeem_activation_code(text) from public,anon;
revoke execute on function public.admin_set_entitlement(uuid,text,text,integer) from public,anon;
revoke execute on function public.admin_list_users(text) from public,anon;
revoke execute on function public.admin_dashboard() from public,anon;
revoke execute on function public.admin_list_activation_codes() from public,anon;
grant execute on function public.get_my_entitlement() to authenticated;
grant execute on function public.redeem_activation_code(text) to authenticated;
grant execute on function public.admin_set_entitlement(uuid,text,text,integer) to authenticated;
grant execute on function public.admin_list_users(text) to authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_list_activation_codes() to authenticated;
