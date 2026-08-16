create extension if not exists pgcrypto;

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  work_date date not null default current_date,
  state text not null default 'not_started' check (state in ('not_started','working','on_break','on_lunch','complete')),
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  first_break_started_at timestamptz,
  first_break_ended_at timestamptz,
  lunch_started_at timestamptz,
  lunch_ended_at timestamptz,
  unique (employee_id, work_date)
);

create table public.employee_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  kiosk_profile_id uuid references public.profiles(id),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.attendance_sessions enable row level security;
alter table public.employee_qr_tokens enable row level security;
alter table public.attendance_devices enable row level security;
create policy "employees read own sessions" on public.attendance_sessions for select to authenticated using (employee_id = auth.uid());
create policy "employees issue own qr" on public.employee_qr_tokens for select to authenticated using (employee_id = auth.uid());

create or replace function public.record_attendance_event(
  p_event_type public.attendance_event_type,
  p_idempotency_key uuid,
  p_source text,
  p_work_mode text default null,
  p_location jsonb default null
) returns public.attendance_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_employee uuid := auth.uid();
  v_session public.attendance_sessions;
begin
  if v_employee is null then raise exception 'Authentication required'; end if;
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

grant execute on function public.record_attendance_event(public.attendance_event_type,uuid,text,text,jsonb) to authenticated;
