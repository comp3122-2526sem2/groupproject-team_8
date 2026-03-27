-- Guest entry throttling must use shared database state so the limit holds
-- across serverless instances and cold starts.

create table if not exists public.guest_entry_rate_limits (
  ip_hash text primary key,
  attempts integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists guest_entry_rate_limits_set_updated_at on public.guest_entry_rate_limits;
create trigger guest_entry_rate_limits_set_updated_at
before update on public.guest_entry_rate_limits
for each row
execute function public.set_updated_at();

create or replace function public.consume_guest_entry_rate_limit_service(
  p_ip_hash text,
  p_limit integer default 5,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ip_hash text := nullif(btrim(p_ip_hash), '');
  v_limit integer := greatest(1, coalesce(p_limit, 1));
  v_window interval := make_interval(secs => greatest(1, coalesce(p_window_seconds, 3600)));
  v_cutoff timestamptz := now() - v_window;
  v_row public.guest_entry_rate_limits;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  if v_ip_hash is null then
    raise exception 'IP hash is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_ip_hash));

  select *
    into v_row
    from public.guest_entry_rate_limits
   where ip_hash = v_ip_hash
   for update;

  if not found then
    insert into public.guest_entry_rate_limits (ip_hash, attempts, window_started_at, updated_at)
    values (v_ip_hash, 1, now(), now());
    return true;
  end if;

  if v_row.window_started_at <= v_cutoff then
    update public.guest_entry_rate_limits
       set attempts = 1,
           window_started_at = now(),
           updated_at = now()
     where ip_hash = v_ip_hash;
    return true;
  end if;

  if v_row.attempts >= v_limit then
    update public.guest_entry_rate_limits
       set updated_at = now()
     where ip_hash = v_ip_hash;
    return false;
  end if;

  update public.guest_entry_rate_limits
     set attempts = attempts + 1,
         updated_at = now()
   where ip_hash = v_ip_hash;

  return true;
end;
$$;

grant execute on function public.consume_guest_entry_rate_limit_service(text, integer, integer) to service_role;
