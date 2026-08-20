-- Deactivate employees instead of hard-deleting them (which is blocked once
-- they have any attendance/leave/disciplinary history -- i.e. every real
-- former employee). No RLS changes: historical data for deactivated
-- employees stays exactly as visible as it is today. Auth-level banning is
-- handled by the set-employee-active edge function (needs the service-role
-- key); these active checks are the DB-side half -- in particular the kiosk
-- clock-in path doesn't use the employee's own Supabase session at all (it
-- authenticates via the paired device + a QR token), so banning their auth
-- account alone would not stop them badging in/out at a shared kiosk.

alter table public.profiles add column active boolean not null default true;

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
  if not exists (select 1 from profiles where id = p_employee_id and active) then
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

create or replace function public.issue_qr_token()
returns table(token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_employee uuid := auth.uid();
  v_token text;
  v_expires timestamptz := now() + interval '30 seconds';
begin
  if v_employee is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from profiles where id = v_employee and active) then
    raise exception 'This account is deactivated.';
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into employee_qr_tokens(employee_id, token_hash, expires_at)
    values (v_employee, encode(digest(v_token, 'sha256'), 'hex'), v_expires);
  return query select v_token, v_expires;
end; $$;

create or replace function public.validate_leave_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_requested_days numeric;
  v_available numeric;
  v_holiday record;
begin
  if not exists (select 1 from profiles where id = new.employee_id and active) then
    raise exception 'This employee account is deactivated.';
  end if;

  select holiday_date, name into v_holiday from holidays
    where holiday_date between new.starts_on and new.ends_on
    order by holiday_date limit 1;
  if v_holiday.holiday_date is not null then
    raise exception 'This date range includes % (%), which is already a bank holiday.', v_holiday.name, to_char(v_holiday.holiday_date, 'DD Mon YYYY');
  end if;

  if new.leave_type = 'unpaid' then
    return new;
  end if;

  v_requested_days := (new.ends_on - new.starts_on + 1);

  select coalesce(earned, 0) - coalesce(used, 0) into v_available
  from leave_balances
  where employee_id = new.employee_id and leave_type = new.leave_type;

  if v_available is null then
    raise exception 'No % leave balance is set up for you yet. Ask HR to set your entitlement before requesting this leave type.', new.leave_type;
  end if;

  if v_requested_days > v_available then
    raise exception 'This request is % days, but only % days of % leave are available to book.', v_requested_days, v_available, new.leave_type;
  end if;

  return new;
end; $$;
