-- Balkania single-tenant PWA foundation. Apply with Supabase CLI migrations.
create type public.attendance_event_type as enum ('clock_in','clock_out','break_start','break_end','lunch_start','lunch_end');
create type public.leave_request_status as enum ('pending','approved','rejected','cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  employee_code text unique not null,
  role text not null default 'employee' check (role in ('employee','manager','hr_admin','kiosk')),
  created_at timestamptz not null default now()
);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  event_type public.attendance_event_type not null,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('pwa','kiosk','web')),
  idempotency_key uuid not null unique,
  work_mode text,
  location jsonb,
  created_at timestamptz not null default now()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  leave_type text not null,
  starts_on date not null,
  ends_on date not null,
  note text,
  status public.leave_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

alter table public.profiles enable row level security;
alter table public.attendance_events enable row level security;
alter table public.leave_requests enable row level security;

create policy "employees read their profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "employees read own attendance" on public.attendance_events for select to authenticated using (employee_id = auth.uid());
create policy "employees read own leave" on public.leave_requests for select to authenticated using (employee_id = auth.uid());
create policy "employees request own leave" on public.leave_requests for insert to authenticated with check (employee_id = auth.uid() and status = 'pending');

-- Attendance events are inserted through a Security Definer Edge Function after
-- validating QR token, kiosk identity, current attendance state and idempotency.
