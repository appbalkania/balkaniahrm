-- Kiosk pairing + camera scanning runtime. Device registration (previous
-- migration) only generated PINs; nothing consumed them. This migration adds
-- the actual pairing flow (PIN -> long-lived device session, no Supabase
-- Auth involved), real employee QR token issuance/validation, and the
-- kiosk-facing identify/record RPCs. The state-machine logic previously
-- inline in record_attendance_event is extracted into a shared internal
-- helper so the kiosk path and the self-service path can't drift apart.

alter table public.attendance_devices
  add column session_token_hash text,
  add column paired boolean not null default false,
  add column last_paired_at timestamptz,
  add column last_seen_at timestamptz;

-- Global (not per-device) pairing rate limiter: pairing has no device
-- selector, so a per-device lockout would let one attacker's failed guesses
-- lock out other legitimate devices. No RLS policies -- fails closed, only
-- ever touched by the security definer functions below.
create table public.kiosk_pairing_attempts (
  id bigserial primary key,
  attempted_at timestamptz not null default now(),
  device_id uuid references public.attendance_devices(id),
  success boolean not null
);
alter table public.kiosk_pairing_attempts enable row level security;
create index kiosk_pairing_attempts_attempted_at_idx on public.kiosk_pairing_attempts (attempted_at);

-- Shared internal helpers. Postgres grants EXECUTE to PUBLIC by default on
-- new functions, so these must have that revoked -- otherwise anon/
-- authenticated could call them directly and bypass every authorization
-- check the wrapper RPCs perform.

create or replace function public._valid_next_event_types(p_state text)
returns public.attendance_event_type[]
language sql immutable set search_path = public as $$
  select case p_state
    when 'not_started' then array['clock_in']::public.attendance_event_type[]
    when 'working'     then array['clock_out','break_start','lunch_start']::public.attendance_event_type[]
    when 'on_break'    then array['break_end']::public.attendance_event_type[]
    when 'on_lunch'    then array['lunch_end']::public.attendance_event_type[]
    else array[]::public.attendance_event_type[]
  end;
$$;
revoke all on function public._valid_next_event_types(text) from public;

-- Array order is load-bearing: index [0] is the kiosk's auto-suggested
-- default action.
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
revoke all on function public._record_attendance_event_core(uuid, public.attendance_event_type, uuid, text, text, jsonb) from public;

-- Re-point the existing self-service RPC at the shared core. Signature and
-- external behavior are unchanged.
drop function if exists public.record_attendance_event(public.attendance_event_type, uuid, text, text, jsonb, uuid);

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

  return public._record_attendance_event_core(v_employee, p_event_type, p_idempotency_key, p_source, p_work_mode, p_location);
end; $$;

grant execute on function public.record_attendance_event(public.attendance_event_type,uuid,text,text,jsonb,uuid) to authenticated;

-- Real employee QR token issuance, replacing the fake client-only string.
create or replace function public.issue_qr_token()
returns table(token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_employee uuid := auth.uid();
  v_token text;
  v_expires timestamptz := now() + interval '30 seconds';
begin
  if v_employee is null then raise exception 'Authentication required'; end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into employee_qr_tokens(employee_id, token_hash, expires_at)
    values (v_employee, encode(digest(v_token, 'sha256'), 'hex'), v_expires);
  return query select v_token, v_expires;
end; $$;

grant execute on function public.issue_qr_token() to authenticated;

-- Device pairing: PIN -> long-lived session token. No device id involved --
-- the PIN-reveal modal only shows label + PIN, so pairing must locate the
-- device by PIN alone.
create or replace function public.pair_attendance_device(p_pin text)
returns table(device_id uuid, device_label text, session_token text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_recent_failures int;
  v_device public.attendance_devices;
  v_token text;
begin
  delete from kiosk_pairing_attempts where attempted_at < now() - interval '1 day';

  select count(*) into v_recent_failures from kiosk_pairing_attempts
    where attempted_at > now() - interval '5 minutes' and not success;
  if v_recent_failures >= 20 then
    raise exception 'Too many pairing attempts. Try again in a few minutes.';
  end if;

  select * into v_device from attendance_devices
    where active and pin_hash = crypt(p_pin, pin_hash)
    limit 1 for update;

  if v_device.id is null then
    insert into kiosk_pairing_attempts(success) values (false);
    raise exception 'Incorrect PIN.';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  update attendance_devices set
    session_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
    paired = true, last_paired_at = now()
  where id = v_device.id;
  insert into kiosk_pairing_attempts(device_id, success) values (v_device.id, true);

  return query select v_device.id, v_device.label, v_token;
end; $$;

grant execute on function public.pair_attendance_device(text) to anon;

-- Kiosk identify + record. The QR token is validated and consumed
-- (single-use, via used_at) only in kiosk_identify_employee;
-- record_kiosk_attendance_event trusts the already-validated device session
-- plus the employee_id the UI resolved a moment earlier -- re-scanning per
-- button tap would be bad UX and isn't required.
create or replace function public.kiosk_identify_employee(p_session_token text, p_qr_token text)
returns table(
  employee_id uuid, full_name text, employee_code text,
  state text, valid_actions public.attendance_event_type[]
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_device public.attendance_devices;
  v_qr record;
  v_state text;
begin
  select * into v_device from attendance_devices
    where active and session_token_hash = encode(digest(p_session_token, 'sha256'), 'hex');
  if v_device.id is null then
    raise exception 'KIOSK_SESSION_INVALID: This device is no longer paired. Enter the current PIN to continue.';
  end if;
  update attendance_devices set last_seen_at = now() where id = v_device.id;

  select eqt.id, eqt.employee_id, p.full_name, p.employee_code into v_qr
    from employee_qr_tokens eqt join profiles p on p.id = eqt.employee_id
    where eqt.token_hash = encode(digest(p_qr_token, 'sha256'), 'hex')
      and eqt.used_at is null and eqt.expires_at > now();

  if v_qr.employee_id is null then
    raise exception 'This code has expired. Ask the employee to refresh it and scan again.';
  end if;

  update employee_qr_tokens set used_at = now() where id = v_qr.id;

  select s.state into v_state from attendance_sessions s
    where s.employee_id = v_qr.employee_id and s.work_date = current_date;
  v_state := coalesce(v_state, 'not_started');

  return query select v_qr.employee_id, v_qr.full_name, v_qr.employee_code, v_state, public._valid_next_event_types(v_state);
end; $$;

grant execute on function public.kiosk_identify_employee(text, text) to anon;

create or replace function public.record_kiosk_attendance_event(
  p_session_token text, p_employee_id uuid,
  p_event_type public.attendance_event_type, p_idempotency_key uuid
) returns public.attendance_sessions
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_device public.attendance_devices;
begin
  select * into v_device from attendance_devices
    where active and session_token_hash = encode(digest(p_session_token, 'sha256'), 'hex');
  if v_device.id is null then
    raise exception 'KIOSK_SESSION_INVALID: This device is no longer paired. Enter the current PIN to continue.';
  end if;
  update attendance_devices set last_seen_at = now() where id = v_device.id;

  if not exists (select 1 from profiles where id = p_employee_id) then
    raise exception 'Unknown employee.';
  end if;

  return public._record_attendance_event_core(p_employee_id, p_event_type, p_idempotency_key, 'kiosk', null, null);
end; $$;

grant execute on function public.record_kiosk_attendance_event(text, uuid, public.attendance_event_type, uuid) to anon;

-- Wire session invalidation into the existing admin RPCs: regenerating the
-- PIN or deactivating a device must force the tablet to re-pair.
create or replace function public.regenerate_device_pin(p_device_id uuid)
returns table(pin text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_pin text;
begin
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can manage kiosk devices';
  end if;
  v_pin := lpad(floor(random() * 1000000)::text, 6, '0');
  update attendance_devices set
    pin_hash = crypt(v_pin, gen_salt('bf')),
    session_token_hash = null, paired = false
  where id = p_device_id;
  if not found then raise exception 'Kiosk device not found'; end if;
  return query select v_pin;
end; $$;

create or replace function public.set_device_active(p_device_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can manage kiosk devices';
  end if;
  update attendance_devices set
    active = p_active,
    session_token_hash = case when not p_active then null else session_token_hash end,
    paired = case when not p_active then false else paired end
  where id = p_device_id;
  if not found then raise exception 'Kiosk device not found'; end if;
end; $$;
