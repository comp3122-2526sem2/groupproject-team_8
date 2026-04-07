-- Recover user-scoped material rows that are stuck in `processing`.

create or replace function public.recover_stuck_materials_for_current_user(
  p_stale_after_minutes int default 20,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_user_id uuid;
  v_stale_after_minutes int;
  v_limit int;
  v_scanned_count int := 0;
  v_requeued_count int := 0;
  v_failed_count int := 0;
  v_skipped_count int := 0;
begin
  v_user_id := public.requesting_user_id();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_stale_after_minutes := greatest(1, coalesce(p_stale_after_minutes, 20));
  v_limit := least(greatest(1, coalesce(p_limit, 50)), 100);

  with accessible_classes as (
    select c.id as class_id
    from public.classes c
    where c.owner_id = v_user_id

    union

    select e.class_id
    from public.enrollments e
    where e.user_id = v_user_id
      and e.role in ('teacher', 'ta')
  ),
  processing_materials as (
    select
      m.id as material_id,
      m.class_id,
      m.storage_path,
      m.created_at
    from public.materials m
    join accessible_classes ac on ac.class_id = m.class_id
    where m.status = 'processing'
      and m.uploaded_by = v_user_id
  ),
  active_job_health as (
    select
      pm.material_id,
      pm.class_id,
      count(j.id) filter (
        where j.status in ('pending', 'retry', 'processing')
      ) as active_job_count,
      max(
        greatest(
          coalesce(j.updated_at, j.created_at),
          coalesce(j.locked_at, '-infinity'::timestamptz)
        )
      ) filter (
        where j.status in ('pending', 'retry', 'processing')
      ) as latest_active_job_at
    from processing_materials pm
    left join public.material_processing_jobs j
      on j.material_id = pm.material_id
     and j.class_id = pm.class_id
    group by pm.material_id, pm.class_id
  ),
  stuck_candidates as (
    select
      pm.material_id,
      pm.class_id,
      pm.storage_path,
      pm.created_at
    from processing_materials pm
    join active_job_health ajh
      on ajh.material_id = pm.material_id
     and ajh.class_id = pm.class_id
    where ajh.active_job_count = 0
       or ajh.latest_active_job_at is null
       or ajh.latest_active_job_at < now() - make_interval(mins => v_stale_after_minutes)
    order by pm.created_at asc, pm.material_id asc
  ),
  limited_candidates as (
    select *
    from stuck_candidates
    limit v_limit
  ),
  limited_candidates_with_storage as (
    select
      lc.material_id,
      lc.class_id,
      lc.storage_path,
      exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'materials'
          and o.name = lc.storage_path
      ) as has_storage_object
    from limited_candidates lc
  ),
  requeued_materials as (
    select
      lcws.material_id,
      public.enqueue_material_job(lcws.material_id, lcws.class_id) as job_id
    from limited_candidates_with_storage lcws
    where lcws.has_storage_object
  ),
  failed_materials as (
    update public.materials m
    set
      status = 'failed',
      metadata = jsonb_set(
        coalesce(m.metadata, '{}'::jsonb),
        '{warnings}',
        to_jsonb(
          array[
            'Processing could not be started. Please delete this file and upload it again.'
          ]::text[]
        ),
        true
      )
    from limited_candidates_with_storage lcws
    where m.id = lcws.material_id
      and not lcws.has_storage_object
    returning m.id
  ),
  failed_jobs as (
    update public.material_processing_jobs j
    set
      status = 'failed',
      stage = 'failed',
      locked_at = null,
      last_error = coalesce(
        nullif(j.last_error, ''),
        'Material file is missing from storage.'
      )
    from limited_candidates_with_storage lcws
    where j.material_id = lcws.material_id
      and j.class_id = lcws.class_id
      and not lcws.has_storage_object
      and j.status in ('pending', 'retry', 'processing')
    returning j.id
  )
  select
    (select count(*) from limited_candidates),
    (select count(*) from requeued_materials),
    (select count(*) from failed_materials),
    greatest(
      (select count(*) from stuck_candidates) - (select count(*) from limited_candidates),
      0
    )
  into
    v_scanned_count,
    v_requeued_count,
    v_failed_count,
    v_skipped_count;

  return jsonb_build_object(
    'scanned_count', v_scanned_count,
    'requeued_count', v_requeued_count,
    'failed_count', v_failed_count,
    'skipped_count', v_skipped_count
  );
end;
$$;

revoke all on function public.recover_stuck_materials_for_current_user(int, int) from public;
grant execute on function public.recover_stuck_materials_for_current_user(int, int) to authenticated;
