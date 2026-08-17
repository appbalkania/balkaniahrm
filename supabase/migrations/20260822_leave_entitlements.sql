-- HR admins can set leave entitlements (annual/medical/unpaid/other) for any
-- employee or manager. leave_balances previously only had SELECT policies, so
-- writes were silently rejected by RLS.

create policy "hr admin insert leave balances" on public.leave_balances
  for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update leave balances" on public.leave_balances
  for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
