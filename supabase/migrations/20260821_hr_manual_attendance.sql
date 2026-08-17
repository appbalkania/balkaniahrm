-- Lets HR admins record a clock event on behalf of an employee (e.g. they
-- forgot to clock in). Adds an optional target-employee argument to
-- record_attendance_event: employees calling it for themselves behave exactly
-- as before, but a caller acting on someone else must be hr_admin.

drop function if exists public.record_attendance_event(public.attendance_event_type, uuid, text, text, jsonb);

alter table public.attendance_events drop constraint if exists attendance_events_source_check;
alter table public.attendance_events add constraint attendance_events_source_check check (source in ('pwa', 'kiosk', 'web', 'admin'));

create function public.record_attendance_event(
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
  v_employee uuid;
  v_session public.attendance_sessions;
begin
  if v_caller is null then raise exception 'Authentication required'; end if;

  if p_employee_id is null or p_employee_id = v_caller then
    v_employee := v_caller;
  else
    if not public.current_role_is(array['hr_admin']) then
      raise exception 'Not authorized to record attendance for another employee';
    end if;
    v_employee := p_employee_id;
  end if;

  select * into v_session from attendance_sessions where employee_id = v_employee and work_date = current_date for update;
  if exists (select 1 from attendance_events where idempotency_key = p_idempotency_key) then return v_session; end if;
  if v_session is null then
    insert into attendance_sessions(employee_id, work_date) values(v_employee, current_date) returning * into v_session;
  end if;
  if (v_session.state = 'not_started' and p_event_type <> 'clock_in')
     or (v_session.state = 'working' and p_event_type not in ('clock_out','break_start','lunch_start'))
     or (v_session.state = 'on_break' and p_event_type <> 'break_end')
     or (v_session.state = 'on_lunch' and p_event_type <> 'lunch_end')
     or v_session.state = 'complete' then raise exception 'Invalid attendance transition'; end if;
  update attendance_sessions set
    state = case p_event_type when 'clock_in' then 'working' when 'clock_out' then 'complete' when 'break_start' then 'on_break' when 'break_end' then 'working' when 'lunch_start' then 'on_lunch' else 'working' end,
    clocked_in_at = case when p_event_type = 'clock_in' then now() else clocked_in_at end,
    clocked_out_at = case when p_event_type = 'clock_out' then now() else clocked_out_at end,
    first_break_started_at = case when p_event_type = 'break_start' then now() else first_break_started_at end,
    first_break_ended_at = case when p_event_type = 'break_end' then now() else first_break_ended_at end,
    lunch_started_at = case when p_event_type = 'lunch_start' then now() else lunch_started_at end,
    lunch_ended_at = case when p_event_type = 'lunch_end' then now() else lunch_ended_at end
  where id = v_session.id returning * into v_session;
  insert into attendance_events(employee_id,event_type,source,idempotency_key,work_mode,location)
  values(v_employee,p_event_type,p_source,p_idempotency_key,p_work_mode,p_location);
  return v_session;
end; $$;

grant execute on function public.record_attendance_event(public.attendance_event_type,uuid,text,text,jsonb,uuid) to authenticated;
