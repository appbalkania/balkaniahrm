-- 20260909_geolocation_attendance.sql gave every employee access to direct
-- PWA clock-in. That's too broad in practice: HR needs to say which specific
-- employees are trusted to self-service (typically remote workers) and which
-- must still use the shared kiosk. Default is "kiosk only" -- the existing
-- company policy -- so nothing changes for anyone until HR opts them in.

alter table public.profiles add column self_service_attendance boolean not null default false;

create or replace function public.record_attendance_event(
  p_event_type public.attendance_event_type,
  p_idempotency_key uuid,
  p_source text,
  p_work_mode text default null,
  p_location jsonb default null,
  p_employee_id uuid default null
) returns public.attendance_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_lat numeric;
  v_lng numeric;
  v_radius int;
  v_location_status text;
begin
  if v_caller is null then raise exception 'Authentication required'; end if;

  if p_employee_id is not null and p_employee_id <> v_caller then
    if not public.current_role_is(array['hr_admin']) then
      raise exception 'Not authorized to record attendance for another employee';
    end if;
    return public._record_attendance_event_core(p_employee_id, p_event_type, p_idempotency_key, p_source, p_work_mode, p_location, null);
  end if;

  if not exists (select 1 from profiles where id = v_caller and self_service_attendance) then
    raise exception 'Attendance must be recorded at the kiosk. Use the shared tablet to clock in, clock out, or start/end a break or lunch.';
  end if;

  v_location_status := null;
  if p_event_type = 'clock_in' and p_work_mode = 'office' then
    select l.latitude, l.longitude, l.radius_meters into v_lat, v_lng, v_radius
      from profiles p
      join attendance_locations l on l.id = p.attendance_location_id
      where p.id = v_caller;

    if not found or p_location is null or p_location->>'latitude' is null then
      v_location_status := 'unavailable';
    else
      v_location_status := case
        when public._distance_meters((p_location->>'latitude')::numeric, (p_location->>'longitude')::numeric, v_lat, v_lng) <= v_radius
        then 'verified' else 'out_of_range' end;
    end if;
  end if;

  return public._record_attendance_event_core(v_caller, p_event_type, p_idempotency_key, p_source, p_work_mode, p_location, v_location_status);
end; $$;
