-- MY CLIENT BOOK / HenryLAB notice history and owner-only notice controls
create table if not exists public.service_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  message text not null check (char_length(trim(message)) between 1 and 1000),
  status text not null default 'active' check (status in ('active','stopped')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  stopped_at timestamptz,
  stopped_by uuid references auth.users(id) on delete set null
);

create index if not exists service_notices_status_created_idx
  on public.service_notices(status, created_at desc);

alter table public.service_notices enable row level security;
revoke all on table public.service_notices from public, anon, authenticated;

-- Preserve an active legacy notice if one exists during migration.
insert into public.service_notices(title,message,status,created_at,created_by)
select trim(notice_title),trim(notice_message),'active',updated_at,updated_by
from public.app_system_config
where id=1
  and notice_enabled
  and nullif(trim(coalesce(notice_title,'')),'') is not null
  and nullif(trim(coalesce(notice_message,'')),'') is not null
  and updated_by is not null
  and not exists (select 1 from public.service_notices);

create or replace function public.get_active_notices()
returns table(
  notice_id uuid,
  title text,
  message text,
  published_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  return query
  select n.id,n.title,n.message,n.created_at,n.created_at
  from public.service_notices n
  where n.status='active'
  order by n.created_at desc;
end;
$$;

create or replace function public.admin_list_notices()
returns table(
  notice_id uuid,
  title text,
  message text,
  status text,
  published_at timestamptz,
  stopped_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_owner() then raise exception '관리자 권한이 없습니다.'; end if;
  return query
  select n.id,n.title,n.message,n.status,n.created_at,n.stopped_at
  from public.service_notices n
  order by n.created_at desc;
end;
$$;

create or replace function public.admin_create_notice(p_title text,p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice public.service_notices%rowtype;
begin
  if not public.is_app_owner() then raise exception '관리자 권한이 없습니다.'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception '공지 제목을 입력해주세요.'; end if;
  if nullif(trim(coalesce(p_message,'')),'') is null then raise exception '공지 내용을 입력해주세요.'; end if;
  if char_length(trim(p_title)) > 80 then raise exception '공지 제목은 80자 이내로 입력해주세요.'; end if;
  if char_length(trim(p_message)) > 1000 then raise exception '공지 내용은 1000자 이내로 입력해주세요.'; end if;

  insert into public.service_notices(title,message,created_by)
  values(trim(p_title),trim(p_message),auth.uid())
  returning * into v_notice;

  perform public.log_admin_action('notice_created','notice',v_notice.id::text,
    jsonb_build_object('title',v_notice.title));

  return jsonb_build_object(
    'notice_id',v_notice.id,
    'title',v_notice.title,
    'message',v_notice.message,
    'status',v_notice.status,
    'published_at',v_notice.created_at,
    'stopped_at',v_notice.stopped_at
  );
end;
$$;

create or replace function public.admin_stop_notice(p_notice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice public.service_notices%rowtype;
begin
  if not public.is_app_owner() then raise exception '관리자 권한이 없습니다.'; end if;

  update public.service_notices
  set status='stopped',stopped_at=now(),stopped_by=auth.uid()
  where id=p_notice_id and status='active'
  returning * into v_notice;

  if v_notice.id is null then raise exception '이미 중지되었거나 찾을 수 없는 공지입니다.'; end if;

  perform public.log_admin_action('notice_stopped','notice',v_notice.id::text,
    jsonb_build_object('title',v_notice.title));

  return jsonb_build_object(
    'notice_id',v_notice.id,
    'status',v_notice.status,
    'stopped_at',v_notice.stopped_at
  );
end;
$$;

-- Keep the old single-notice endpoint safe for older installed clients.
create or replace function public.get_system_notice()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_notice public.service_notices%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into v_notice
  from public.service_notices
  where status='active'
  order by created_at desc
  limit 1;

  if v_notice.id is null then
    return jsonb_build_object('notice_enabled',false,'maintenance_enabled',false);
  end if;

  return jsonb_build_object(
    'notice_enabled',true,
    'notice_id',v_notice.id,
    'notice_title',v_notice.title,
    'notice_message',v_notice.message,
    'maintenance_enabled',false,
    'updated_at',v_notice.created_at
  );
end;
$$;

revoke execute on function public.get_active_notices() from public, anon;
revoke execute on function public.admin_list_notices() from public, anon;
revoke execute on function public.admin_create_notice(text,text) from public, anon;
revoke execute on function public.admin_stop_notice(uuid) from public, anon;
revoke execute on function public.get_system_notice() from public, anon;

grant execute on function public.get_active_notices() to authenticated;
grant execute on function public.admin_list_notices() to authenticated;
grant execute on function public.admin_create_notice(text,text) to authenticated;
grant execute on function public.admin_stop_notice(uuid) to authenticated;
grant execute on function public.get_system_notice() to authenticated;
