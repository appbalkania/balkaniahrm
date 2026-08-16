-- Replaces the direct profiles.manager_id link with team-based management:
-- HR creates teams and assigns each team a manager, and every employee belongs
-- to a team. A manager's scope (attendance, leave, disciplinary) is now derived
-- from "which team is this employee on, and who manages that team" instead of
-- a manager_id set directly on the employee.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manager_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;

create policy "authenticated read teams" on public.teams
  for select to authenticated using (true);
create policy "hr admin create teams" on public.teams
  for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update teams" on public.teams
  for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete teams" on public.teams
  for delete to authenticated using (public.current_role_is(array['hr_admin']));

alter table public.profiles add column team_id uuid references public.teams(id);

-- "managers read their reports profiles" previously checked profiles.manager_id
-- directly; replace it with a team-membership check before that column is dropped.
drop policy "managers read their reports profiles" on public.profiles;
create policy "managers read their reports profiles" on public.profiles
  for select to authenticated using (
    team_id in (select id from public.teams where manager_id = auth.uid())
  );

-- Every other manager-scoped policy (attendance, leave, disciplinary) calls this
-- function rather than checking manager_id directly, so updating it here is
-- enough to move all of them onto the team model.
create or replace function public.is_manager_of(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.teams t on t.id = p.team_id
    where p.id = p_employee_id and t.manager_id = auth.uid()
  );
$$;

alter table public.profiles drop column manager_id;
