create table public.departments (id uuid primary key default gen_random_uuid(), name text not null unique, manager_id uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.work_schedules (id uuid primary key default gen_random_uuid(), name text not null, branch_name text, starts_at time not null, ends_at time not null, working_days smallint[] not null default array[1,2,3,4,5], is_default boolean not null default false, created_at timestamptz not null default now());
create table public.employee_schedule_assignments (employee_id uuid primary key references public.profiles(id) on delete cascade, schedule_id uuid not null references public.work_schedules(id), effective_from date not null default current_date, effective_to date);
create table public.leave_balances (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id), leave_type text not null, entitlement numeric(6,2) not null default 0, earned numeric(6,2) not null default 0, used numeric(6,2) not null default 0, unique(employee_id,leave_type));
alter table public.departments enable row level security; alter table public.work_schedules enable row level security; alter table public.employee_schedule_assignments enable row level security; alter table public.leave_balances enable row level security;
create policy "employees read schedules" on public.work_schedules for select to authenticated using (true);
create policy "employees read own schedule assignment" on public.employee_schedule_assignments for select to authenticated using (employee_id = auth.uid());
create policy "employees read own leave balances" on public.leave_balances for select to authenticated using (employee_id = auth.uid());
create or replace function public.review_leave_request(p_request_id uuid,p_status public.leave_request_status,p_comment text default null) returns public.leave_requests language plpgsql security definer set search_path=public as $$
declare v_request public.leave_requests; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Only approvals or rejections are allowed'; end if;
 update leave_requests set status=p_status where id=p_request_id and status='pending' returning * into v_request;
 if v_request is null then raise exception 'Leave request is unavailable or already reviewed'; end if;
 if p_status='approved' then update leave_balances set used=used + (v_request.ends_on-v_request.starts_on+1) where employee_id=v_request.employee_id and leave_type=v_request.leave_type; end if;
 return v_request; end; $$;
grant execute on function public.review_leave_request(uuid,public.leave_request_status,text) to authenticated;
