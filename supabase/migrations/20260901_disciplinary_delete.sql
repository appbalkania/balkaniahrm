-- Lets HR admins delete a disciplinary record (e.g. one issued in error).
-- Managers can still issue actions for their own reports but not delete them
-- -- deletion is an HR-only correction, not a normal day-to-day action.
create policy "hr admin deletes disciplinary actions" on public.disciplinary_actions
  for delete to authenticated using (public.current_role_is(array['hr_admin']));
