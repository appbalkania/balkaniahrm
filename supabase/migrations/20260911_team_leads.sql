-- Team leads: a supervision layer between employees and managers. Each team
-- now has a lead (day-to-day attendance, leave and disciplinary for that team)
-- as well as a manager, who sits above the lead. A manager overseeing several
-- teams therefore has several team leads reporting to them.
--
-- Leads get the same admin-portal scope managers already had, over their own
-- team only. Managers keep that scope over every team they manage *and* over
-- the leads themselves, and can reverse a lead's leave decision or withdraw a
-- disciplinary action the lead issued.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('employee', 'manager', 'team_lead', 'hr_admin', 'kiosk'));

alter table public.teams add column team_lead_id uuid references public.profiles(id);

-- A manager covers everyone on the teams they manage, plus those teams' leads
-- (matched directly, so a lead is still in scope even if their own team_id was
-- never set to the team they run).
--
-- Both this and is_team_lead_of() now exclude the caller themselves. Without
-- that guard a supervisor sitting on their own team would pass their own
-- authorization check and could approve their own leave.
create or replace function public.is_manager_of(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_employee_id <> auth.uid() and exists (
    select 1
    from public.teams t
    where t.manager_id = auth.uid()
      and (
        t.team_lead_id = p_employee_id
        or exists (select 1 from public.profiles p where p.id = p_employee_id and p.team_id = t.id)
      )
  );
$$;

create or replace function public.is_team_lead_of(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_employee_id <> auth.uid() and exists (
    select 1
    from public.profiles p
    join public.teams t on t.id = p.team_id
    where p.id = p_employee_id and t.team_lead_id = auth.uid()
  );
$$;

grant execute on function public.is_team_lead_of(uuid) to authenticated;

-- Used by every read policy that previously said "managers read their reports".
-- Authority that managers hold *over* leads (leave override, disciplinary
-- withdrawal) deliberately keeps calling is_manager_of instead.
create or replace function public.can_supervise(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager_of(p_employee_id) or public.is_team_lead_of(p_employee_id);
$$;

grant execute on function public.can_supervise(uuid) to authenticated;

drop policy "managers read their reports profiles" on public.profiles;
create policy "supervisors read their reports profiles" on public.profiles
  for select to authenticated using (
    team_id in (select id from public.teams where manager_id = auth.uid() or team_lead_id = auth.uid())
    or id in (select team_lead_id from public.teams where manager_id = auth.uid())
  );

drop policy "managers read their reports attendance events" on public.attendance_events;
create policy "supervisors read their reports attendance events" on public.attendance_events
  for select to authenticated using (public.can_supervise(employee_id));

drop policy "managers read their reports attendance sessions" on public.attendance_sessions;
create policy "supervisors read their reports attendance sessions" on public.attendance_sessions
  for select to authenticated using (public.can_supervise(employee_id));

drop policy "managers read their reports leave requests" on public.leave_requests;
create policy "supervisors read their reports leave requests" on public.leave_requests
  for select to authenticated using (public.can_supervise(employee_id));

drop policy "managers read their reports leave balances" on public.leave_balances;
create policy "supervisors read their reports leave balances" on public.leave_balances
  for select to authenticated using (public.can_supervise(employee_id));

drop policy "managers read their reports disciplinary actions" on public.disciplinary_actions;
create policy "supervisors read their reports disciplinary actions" on public.disciplinary_actions
  for select to authenticated using (public.can_supervise(employee_id));

drop policy "managers read their reports asset assignments" on public.asset_assignments;
create policy "supervisors read their reports asset assignments" on public.asset_assignments
  for select to authenticated using (public.can_supervise(employee_id));

-- Leave review, now with manager override. A pending request can be decided by
-- the team lead, the manager, or HR. Once decided, only the manager or HR can
-- change that decision -- a lead can't revisit their own call.
create or replace function public.review_leave_request(p_request_id uuid, p_status public.leave_request_status, p_comment text default null)
returns public.leave_requests language plpgsql security definer set search_path = public as $$
declare
  v_request public.leave_requests;
  v_employee uuid;
  v_previous public.leave_request_status;
  v_days int;
  v_can_override boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Only approvals or rejections are allowed'; end if;

  select employee_id, status into v_employee, v_previous
    from leave_requests where id = p_request_id for update;
  if v_employee is null then raise exception 'Leave request not found'; end if;

  v_can_override := public.current_role_is(array['hr_admin']) or public.is_manager_of(v_employee);
  if not (v_can_override or public.is_team_lead_of(v_employee)) then
    raise exception 'Not authorized to review this request';
  end if;

  if v_previous = 'cancelled' then
    raise exception 'This request was cancelled by the employee and can no longer be reviewed.';
  end if;
  if v_previous <> 'pending' and not v_can_override then
    raise exception 'This request was already reviewed. Only a manager or HR can change that decision.';
  end if;
  if v_previous = p_status then
    raise exception 'This request is already %.', p_status;
  end if;

  update leave_requests set status = p_status where id = p_request_id returning * into v_request;

  -- Keep the balance in step with the decision in both directions: approving
  -- consumes days, and reversing an approval hands them back. Without the
  -- second branch an overridden approval would leave the days permanently
  -- deducted from the employee's balance.
  v_days := (v_request.ends_on - v_request.starts_on + 1);
  if p_status = 'approved' and v_previous <> 'approved' then
    update leave_balances set used = used + v_days
      where employee_id = v_request.employee_id and leave_type = v_request.leave_type
        and leave_year_start = public.current_leave_year_start();
  elsif v_previous = 'approved' and p_status <> 'approved' then
    update leave_balances set used = greatest(0, used - v_days)
      where employee_id = v_request.employee_id and leave_type = v_request.leave_type
        and leave_year_start = public.current_leave_year_start();
  end if;

  return v_request;
end; $$;

-- Leads can issue disciplinary actions for their own team, same as managers.
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
  if not (public.current_role_is(array['hr_admin']) or public.can_supervise(p_employee_id)) then
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

-- Managers can withdraw an action issued within their scope (typically one a
-- team lead issued). Leads themselves still can't delete -- HR keeps that too.
create policy "managers delete their reports disciplinary actions" on public.disciplinary_actions
  for delete to authenticated using (public.is_manager_of(employee_id));
