-- HR admins can edit employee profiles directly (name, employee code, role,
-- team). There was previously no UPDATE policy on profiles at all, so this was
-- silently rejected by RLS. Deleting an employee goes through the
-- delete-employee edge function instead (it removes the auth.users row, which
-- cascades to profiles) since that requires the service-role key.

create policy "hr admin update profiles" on public.profiles
  for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
