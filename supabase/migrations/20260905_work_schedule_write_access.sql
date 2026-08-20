-- work_schedules had only a SELECT policy ("employees read schedules") since
-- 20260816_admin_core.sql, so any insert/update/delete was silently rejected
-- by RLS -- the same gap 20260822 fixed for leave_balances. The admin UI never
-- surfaced this because its "Create shift" button was a stub that only printed
-- a notice instead of writing anything. Adding the HR-admin write policies so
-- the shift-template form can actually save.

create policy "hr admin insert work schedules" on public.work_schedules
  for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update work schedules" on public.work_schedules
  for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete work schedules" on public.work_schedules
  for delete to authenticated using (public.current_role_is(array['hr_admin']));

-- Only one template can be the default; without this, several rows could each
-- claim it and the "Default" pill would be meaningless. Enforced as a partial
-- unique index rather than in application code so it holds for every writer.
create unique index work_schedules_single_default_idx
  on public.work_schedules ((is_default)) where is_default;
