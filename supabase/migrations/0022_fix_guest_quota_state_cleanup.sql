-- Keep the global guest AI quota state aligned when slots are released
-- multiple times or when sandboxes are discarded/cleaned up while requests
-- are still considered in flight.

create or replace function public.release_guest_ai_slot_service(
  p_sandbox_id uuid
)
returns public.guest_sandboxes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.guest_sandboxes;
  v_released integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_sandboxes
     set active_ai_requests = greatest(active_ai_requests - 1, 0),
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
     and active_ai_requests > 0
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  v_released := 1;

  insert into public.guest_ai_quota_state (scope, active_requests, updated_at)
  values ('global', 0, now())
  on conflict (scope) do nothing;

  update public.guest_ai_quota_state
     set active_requests = greatest(active_requests - v_released, 0),
         updated_at = now()
   where scope = 'global';

  return v_row;
end;
$$;

grant execute on function public.release_guest_ai_slot_service(uuid) to service_role;

create or replace function public.discard_guest_sandbox(
  p_sandbox_id uuid
)
returns public.guest_sandboxes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.guest_sandboxes;
  v_row public.guest_sandboxes;
  v_released integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.guest_sandboxes gs
   where gs.id = p_sandbox_id
     and gs.user_id = auth.uid()
     and gs.status = 'active'
   for update;

  if not found then
    raise exception 'Guest sandbox not found.' using errcode = 'P0002';
  end if;

  v_released := greatest(coalesce(v_existing.active_ai_requests, 0), 0);

  if v_released > 0 then
    insert into public.guest_ai_quota_state (scope, active_requests, updated_at)
    values ('global', 0, now())
    on conflict (scope) do nothing;

    update public.guest_ai_quota_state
       set active_requests = greatest(active_requests - v_released, 0),
           updated_at = now()
     where scope = 'global';
  end if;

  delete from public.classes
   where sandbox_id = p_sandbox_id;

  update public.guest_sandboxes
     set status = 'discarded',
         active_ai_requests = 0,
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.discard_guest_sandbox(uuid) to authenticated;

create or replace function public.cleanup_expired_guest_sandboxes(
  p_batch_size integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
  v_rows_affected integer := 0;
  v_did_work boolean;
  v_released integer := 0;
begin
  insert into public.guest_ai_quota_state (scope, active_requests, updated_at)
  values ('global', 0, now())
  on conflict (scope) do nothing;

  for v_row in
    select gs.id, gs.user_id, greatest(coalesce(gs.active_ai_requests, 0), 0) as active_ai_requests
    from public.guest_sandboxes gs
    where gs.status in ('expired', 'discarded')
       or (
         gs.status = 'active'
         and (
           gs.expires_at <= now()
           or gs.last_seen_at <= now() - interval '1 hour'
         )
       )
    order by gs.expires_at asc nulls first, gs.last_seen_at asc, gs.created_at asc
    limit v_limit
    for update skip locked
  loop
    v_did_work := false;
    v_released := greatest(coalesce(v_row.active_ai_requests, 0), 0);

    if v_released > 0 then
      update public.guest_ai_quota_state
         set active_requests = greatest(active_requests - v_released, 0),
             updated_at = now()
       where scope = 'global';
    end if;

    delete from public.classes where sandbox_id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then
      v_did_work := true;
    end if;

    delete from auth.users where id = v_row.user_id and coalesce(is_anonymous, false);
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then
      v_did_work := true;
    end if;

    delete from public.guest_sandboxes where id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then
      v_did_work := true;
    end if;

    if v_did_work then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Atomically releases all in-flight AI slots for a sandbox from the global
-- quota counter. Called by the Edge Function cleanup job before deleting the
-- sandbox row so the global counter stays accurate.
create or replace function public.release_guest_sandbox_quota(
  p_sandbox_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  select greatest(coalesce(active_ai_requests, 0), 0)
    into v_count
    from public.guest_sandboxes
   where id = p_sandbox_id;

  if v_count > 0 then
    update public.guest_ai_quota_state
       set active_requests = greatest(active_requests - v_count, 0),
           updated_at = now()
     where scope = 'global';
  end if;
end;
$$;

grant execute on function public.release_guest_sandbox_quota(uuid) to service_role;
