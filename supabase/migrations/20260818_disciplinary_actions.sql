-- Lets managers issue disciplinary actions to their own direct reports, and HR
-- admins issue/view them for anyone. Reuses the is_manager_of() helper and role
-- policies introduced for attendance/leave scoping.

create type public.disciplinary_severity as enum ('verbal_warning', 'written_warning', 'final_warning', 'suspension', 'termination_notice');

create table public.disciplinary_actions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  issued_by uuid not null references public.profiles(id),
  severity public.disciplinary_severity not null,
  reason text not null,
  details text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.disciplinary_actions enable row level security;

create policy "employees read own disciplinary actions" on public.disciplinary_actions
  for select to authenticated using (employee_id = auth.uid());
create policy "hr admin reads all disciplinary actions" on public.disciplinary_actions
  for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "managers read their reports disciplinary actions" on public.disciplinary_actions
  for select to authenticated using (public.is_manager_of(employee_id));

-- Inserts go through this function (not a direct table policy) so authorization,
-- required-field checks, and the issued_by stamp all live in one trusted place.
create or replace function public.issue_disciplinary_action(
  p_employee_id uuid,
  p_severity public.disciplinary_severity,
  p_reason text,
  p_details text default null,
  p_occurred_on date default current_date
) returns public.disciplinary_actions language plpgsql security definer set search_path = public as $$
declare
  v_action public.disciplinary_actions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.current_role_is(array['hr_admin']) or public.is_manager_of(p_employee_id)) then
    raise exception 'Not authorized to issue disciplinary actions for this employee';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  insert into public.disciplinary_actions (employee_id, issued_by, severity, reason, details, occurred_on)
  values (p_employee_id, auth.uid(), p_severity, trim(p_reason), nullif(trim(coalesce(p_details, '')), ''), coalesce(p_occurred_on, current_date))
  returning * into v_action;
  return v_action;
end; $$;

grant execute on function public.issue_disciplinary_action(uuid, public.disciplinary_severity, text, text, date) to authenticated;
