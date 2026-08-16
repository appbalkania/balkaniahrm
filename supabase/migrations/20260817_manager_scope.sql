-- Managers must only see attendance and leave data for the employees who report
-- to them. HR admins keep full visibility. Previously "managers read all ..."
-- policies gave managers the same company-wide access as hr_admin, which this
-- migration narrows.

alter table public.profiles add column manager_id uuid references public.profiles(id);

create or replace function public.is_manager_of(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = p_employee_id and manager_id = auth.uid()
  );
$$;

grant execute on function public.is_manager_of(uuid) to authenticated;

drop policy "managers read all profiles" on public.profiles;
create policy "hr admin reads all profiles" on public.profiles
  for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "managers read their reports profiles" on public.profiles
  for select to authenticated using (manager_id = auth.uid());

drop policy "managers read all attendance events" on public.attendance_events;
create policy "hr admin reads all attendance events" on public.attendance_events
  for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "managers read their reports attendance events" on public.attendance_events
  for select to authenticated using (public.is_manager_of(employee_id));

drop policy "managers read all attendance sessions" on public.attendance_sessions;
create policy "hr admin reads all attendance sessions" on public.attendance_sessions
  for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "managers read their reports attendance sessions" on public.attendance_sessions
  for select to authenticated using (public.is_manager_of(employee_id));

drop policy "managers read all leave requests" on public.leave_requests;
create policy "hr admin reads all leave requests" on public.leave_requests
  for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "managers read their reports leave requests" on public.leave_requests
  for select to authenticated using (public.is_manager_of(employee_id));

drop policy "managers read all leave balances" on public.leave_balances;
create policy "hr admin reads all leave balances" on public.leave_balances
  for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "managers read their reports leave balances" on public.leave_balances
  for select to authenticated using (public.is_manager_of(employee_id));

-- Kiosk device management is HR-only now that managers are scoped to attendance + leave review.
drop policy "managers manage attendance devices" on public.attendance_devices;
create policy "hr admin reads attendance devices" on public.attendance_devices
  for select to authenticated using (public.current_role_is(array['hr_admin']));

-- review_leave_request previously only checked the caller was authenticated, so any
-- signed-in employee could approve/reject any request. Restrict it to HR admins and
-- the requester's own manager.
create or replace function public.review_leave_request(p_request_id uuid, p_status public.leave_request_status, p_comment text default null)
returns public.leave_requests language plpgsql security definer set search_path = public as $$
declare
  v_request public.leave_requests;
  v_employee uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Only approvals or rejections are allowed'; end if;

  select employee_id into v_employee from leave_requests where id = p_request_id;
  if v_employee is null then raise exception 'Leave request is unavailable or already reviewed'; end if;
  if not (public.current_role_is(array['hr_admin']) or public.is_manager_of(v_employee)) then
    raise exception 'Not authorized to review this request';
  end if;

  update leave_requests set status = p_status where id = p_request_id and status = 'pending' returning * into v_request;
  if v_request is null then raise exception 'Leave request is unavailable or already reviewed'; end if;
  if p_status = 'approved' then
    update leave_balances set used = used + (v_request.ends_on - v_request.starts_on + 1)
      where employee_id = v_request.employee_id and leave_type = v_request.leave_type;
  end if;
  return v_request;
end; $$;
