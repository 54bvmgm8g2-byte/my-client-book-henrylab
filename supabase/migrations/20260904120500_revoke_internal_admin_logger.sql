-- Internal helper: only other SECURITY DEFINER admin functions call this.
revoke all on function public.log_admin_action(text,text,text,jsonb) from public, anon, authenticated;
