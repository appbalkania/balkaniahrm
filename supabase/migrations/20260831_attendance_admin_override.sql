-- Fixes a bug found right after shipping employee deactivation: the active
-- check in _record_attendance_event_core blocked *every* source, including
-- HR's manual "Record attendance" action -- so an employee deactivated
-- mid-shift was left permanently stuck in "Working" with no way to close
-- their session out, not even by HR. Only self-service (pwa) and kiosk
-- sources should be blocked; source='admin' (HR acting on someone's behalf)
-- must still work.
create or replace function public._record_attendance_event_core(
  p_employee_id uuid,
  p_event_type public.attendance_event_type,
  p_idempotency_key uuid,
  p_source text,
  p_work_mode text,
  p_location jsonb
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
    lunch_ended_at = case when p_event_type = 'lunch_end' then now() else lunch_ended_at end
  where id = v_session.id returning * into v_session;

  insert into attendance_events(employee_id, event_type, source, idempotency_key, work_mode, location)
    values (p_employee_id, p_event_type, p_source, p_idempotency_key, p_work_mode, p_location);

  return v_session;
end; $$;

-- Called by the set-employee-active edge function (service-role only, not
-- exposed to anon/authenticated) when deactivating someone who's currently
-- clocked in, so nobody is ever left stuck in an open session.
create or replace function public._auto_close_attendance_session(p_employee_id uuid)
returns void language plpgsql set search_path = public as $$
declare
  v_session public.attendance_sessions;
begin
  select * into v_session from attendance_sessions
    where employee_id = p_employee_id and work_date = current_date for update;

  if v_session is null or v_session.state in ('not_started', 'complete') then
    return;
  end if;

  update attendance_sessions set
    state = 'complete',
    clocked_out_at = now(),
    first_break_ended_at = case when v_session.state = 'on_break' then now() else first_break_ended_at end,
    lunch_ended_at = case when v_session.state = 'on_lunch' then now() else lunch_ended_at end
  where id = v_session.id;

  insert into attendance_events(employee_id, event_type, source, idempotency_key)
    values (p_employee_id, 'clock_out', 'admin', gen_random_uuid());
end; $$;
revoke all on function public._auto_close_attendance_session(uuid) from public;
grant execute on function public._auto_close_attendance_session(uuid) to service_role;
