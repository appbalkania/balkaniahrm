-- Geolocation-gated self-service clock-in. Kiosk-only policy (20260904) stays
-- the default safety net, but employees can now also clock themselves in
-- through the PWA when they select "office" mode and are near an HR-assigned
-- attendance location. Out-of-range or unverifiable check-ins are flagged for
-- HR review, not blocked -- a bad GPS fix shouldn't lock someone out.
--
-- Named "attendance_locations", not "branches": work_schedules.branch_name is
-- already an unrelated free-text label, and this is a real assignable entity.

create table public.attendance_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  radius_meters int not null default 150 check (radius_meters > 0),
  created_at timestamptz not null default now()
);

alter table public.attendance_locations enable row level security;

create policy "authenticated read attendance locations" on public.attendance_locations
  for select to authenticated using (true);
create policy "hr admin insert attendance locations" on public.attendance_locations
  for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update attendance locations" on public.attendance_locations
  for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete attendance locations" on public.attendance_locations
  for delete to authenticated using (public.current_role_is(array['hr_admin']));

alter table public.profiles add column attendance_location_id uuid references public.attendance_locations(id);

alter table public.attendance_sessions add column clock_in_location_status text
  check (clock_in_location_status in ('verified', 'out_of_range', 'unavailable'));

create or replace function public._distance_meters(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

-- Adds a trailing p_location_status param (default null, so the kiosk and
-- admin-override call sites -- which never pass it -- are unaffected) and
-- records it on the session only for the clock_in event. Everything else
-- (idempotency check, transition validation, event insert) is unchanged from
-- the 20260831_attendance_admin_override.sql version of this function.
create or replace function public._record_attendance_event_core(
  p_employee_id uuid,
  p_event_type public.attendance_event_type,
  p_idempotency_key uuid,
  p_source text,
  p_work_mode text,
  p_location jsonb,
  p_location_status text default null
) returns public.attendance_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_session public.attendance_sessions;
begin
  if p_source <> 'admin' and not exists (select 1 from profiles where id = p_employee_id and active) then
    raise exception 'This employee account is deactivated.';
  end if;

  select * into v_session from attendance_sessions
    where employee_id = p_employee_id and work_date = current_date for update;

  if exists (select 1 from attendance_events where idempotency_key = p_idempotency_key) then
    return v_session;
  end if;

  if v_session is null then
    insert into attendance_sessions(employee_id, work_date) values (p_employee_id, current_date) returning * into v_session;
  end if;

  if not (p_event_type = any(public._valid_next_event_types(v_session.state))) then
    raise exception 'Invalid attendance transition';
  end if;

  update attendance_sessions set
    state = case p_event_type
      when 'clock_in' then 'working' when 'clock_out' then 'complete'
      when 'break_start' then 'on_break' when 'break_end' then 'working'
      when 'lunch_start' then 'on_lunch' else 'working' end,
    clocked_in_at = case when p_event_type = 'clock_in' then now() else clocked_in_at end,
    clocked_out_at = case when p_event_type = 'clock_out' then now() else clocked_out_at end,
    first_break_started_at = case when p_event_type = 'break_start' then now() else first_break_started_at end,
    first_break_ended_at = case when p_event_type = 'break_end' then now() else first_break_ended_at end,
    lunch_started_at = case when p_event_type = 'lunch_start' then now() else lunch_started_at end,
    lunch_ended_at = case when p_event_type = 'lunch_end' then now() else lunch_ended_at end,
    clock_in_location_status = case when p_event_type = 'clock_in' then p_location_status else clock_in_location_status end
  where id = v_session.id returning * into v_session;

  insert into attendance_events(employee_id, event_type, source, idempotency_key, work_mode, location)
    values (p_employee_id, p_event_type, p_source, p_idempotency_key, p_work_mode, p_location);

  return v_session;
end; $$;

-- Re-adds the self-service branch that 20260904_kiosk_only_attendance.sql
-- removed. The p_employee_id-set + hr_admin branch (HR recording on an
-- employee's behalf) is unchanged. Self-service now checks location only for
-- a clock_in in "office" mode; every other event/mode passes through exactly
-- as the kiosk path already does, with no location check at all.
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

grant execute on function public.record_attendance_event(public.attendance_event_type, uuid, text, text, jsonb, uuid) to authenticated;
