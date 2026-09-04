-- Resolve pgcrypto explicitly because Supabase installs it in the extensions schema.
create or replace function public.admin_generate_activation_codes(p_count integer default 10)
returns table(label text, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := greatest(1,least(coalesce(p_count,10),50));
  v_seq int;
  v_code text;
  v_label text;
  i int;
begin
  if not public.is_app_owner() then raise exception '관리자 권한이 없습니다.'; end if;
  select coalesce(max(nullif(regexp_replace(coalesce(ac.label,''),'[^0-9]','','g'),'')::int),0)
  into v_seq
  from public.activation_codes ac;

  for i in 1..v_count loop
    v_seq:=v_seq+1;
    v_label:='KMONG-'||lpad(v_seq::text,3,'0');
    loop
      v_code:='MCB-'||upper(substr(md5(gen_random_uuid()::text),1,4))||'-'||upper(substr(md5(gen_random_uuid()::text),1,4))||'-'||upper(substr(md5(gen_random_uuid()::text),1,4));
      begin
        insert into public.activation_codes(code_hash,label,is_active)
        values(extensions.digest(upper(v_code),'sha256'),v_label,true);
        exit;
      exception when unique_violation then
      end;
    end loop;
    label:=v_label;
    code:=v_code;
    return next;
  end loop;

  perform public.log_admin_action('codes_generated','activation_code',null,
    jsonb_build_object('count',v_count,'first_label','KMONG-'||lpad((v_seq-v_count+1)::text,3,'0'),'last_label','KMONG-'||lpad(v_seq::text,3,'0')));
end;
$$;

create or replace function public.redeem_activation_code(p_code text)
returns table(success boolean,message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code_id uuid;
  v_current_status text;
begin
  if v_uid is null then
    return query select false,'로그인이 필요합니다.';
    return;
  end if;

  select status into v_current_status
  from public.app_entitlements
  where user_id=v_uid;

  if v_current_status='active' then
    return query select true,'이미 사용 가능한 계정입니다.';
    return;
  end if;

  select id into v_code_id
  from public.activation_codes
  where code_hash=extensions.digest(upper(trim(p_code)),'sha256')
    and is_active=true
    and redeemed_at is null
    and (expires_at is null or expires_at>now())
  for update skip locked;

  if v_code_id is null then
    return query select false,'유효하지 않거나 이미 사용된 이용코드입니다.';
    return;
  end if;

  update public.activation_codes
  set redeemed_at=now(),redeemed_by=v_uid
  where id=v_code_id;

  insert into public.app_entitlements(user_id,status,source,expires_at)
  values(v_uid,'active','kmong_code',null)
  on conflict(user_id) do update
    set status='active',source='kmong_code',expires_at=null,updated_at=now();

  return query select true,'이용권이 활성화되었습니다.';
end;
$$;

revoke execute on function public.admin_generate_activation_codes(integer) from public, anon;
revoke execute on function public.redeem_activation_code(text) from public, anon;
grant execute on function public.admin_generate_activation_codes(integer) to authenticated;
grant execute on function public.redeem_activation_code(text) to authenticated;
