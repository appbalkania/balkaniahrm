-- record_attendance_event's self-service branch (an employee acting on their
-- own attendance) let the PWA call clock_in/clock_out/break/lunch directly
-- with source='pwa', bypassing the kiosk entirely -- the UI had a full grid
-- of direct action buttons alongside the "scan this at the kiosk" QR code.
-- Company policy is that every event must be recorded at the shared kiosk
-- device. This removes the self-service branch so employees can only clock
-- via record_kiosk_attendance_event (which requires a paired device session),
-- while HR's "record on behalf of an employee" override (still routed
-- through this same function, with an explicit p_employee_id) is unchanged.

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
  v_employee uuid;
begin
  if v_caller is null then raise exception 'Authentication required'; end if;

  if p_employee_id is null or p_employee_id = v_caller then
    raise exception 'Attendance must be recorded at the kiosk. Use the shared tablet to clock in, clock out, or start/end a break or lunch.';
  end if;

  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Not authorized to record attendance for another employee';
  end if;
  v_employee := p_employee_id;

  return public._record_attendance_event_core(v_employee, p_event_type, p_idempotency_key, p_source, p_work_mode, p_location);
end; $$;
