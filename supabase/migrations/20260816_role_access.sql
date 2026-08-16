-- Role-based read access for the admin portal. Uses a SECURITY DEFINER helper so the
-- role check does not re-enter RLS on public.profiles for the calling policies.
create or replace function public.current_role_is(roles text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(roles));
$$;

grant execute on function public.current_role_is(text[]) to authenticated;

create policy "managers read all profiles" on public.profiles
  for select to authenticated using (public.current_role_is(array['manager', 'hr_admin']));

create policy "managers read all attendance events" on public.attendance_events
  for select to authenticated using (public.current_role_is(array['manager', 'hr_admin']));

create policy "managers read all attendance sessions" on public.attendance_sessions
  for select to authenticated using (public.current_role_is(array['manager', 'hr_admin']));

create policy "managers read all leave requests" on public.leave_requests
  for select to authenticated using (public.current_role_is(array['manager', 'hr_admin']));

create policy "managers read all leave balances" on public.leave_balances
  for select to authenticated using (public.current_role_is(array['manager', 'hr_admin']));

create policy "managers manage attendance devices" on public.attendance_devices
  for select to authenticated using (public.current_role_is(array['manager', 'hr_admin']));

-- Departments had RLS enabled but no policy, which made them unreadable to everyone.
create policy "authenticated read departments" on public.departments
  for select to authenticated using (true);
