-- Payroll: pay-period based payslip generation. Employees carry a monthly
-- salary or an hourly rate; opening a period drafts one payslip per active
-- employee (hours pulled from attendance_sessions for hourly staff), HR
-- adjusts it with itemized earning/deduction lines, then locks the period so
-- line items can no longer change and marks it paid.
--
-- Follows the asset_management pattern: reads/writes are gated by RLS, but
-- every state-changing operation goes through a security definer function so
-- the role check, the generated-amount math, and keeping payslip totals in
-- step with their line items all live in one trusted place. HR-admin only in
-- this phase -- no manager or employee self-service access to payroll data.

create type public.pay_type as enum ('salary', 'hourly');

create table public.employee_compensation (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  pay_type public.pay_type not null default 'salary',
  monthly_salary numeric(12,2),
  hourly_rate numeric(12,2),
  currency text not null default 'EUR',
  updated_at timestamptz not null default now(),
  check ((pay_type = 'salary' and monthly_salary is not null and monthly_salary >= 0)
      or (pay_type = 'hourly' and hourly_rate is not null and hourly_rate >= 0))
);

create type public.payroll_period_status as enum ('draft', 'finalized', 'paid');

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  starts_on date not null,
  ends_on date not null,
  status public.payroll_period_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  finalized_by uuid references public.profiles(id),
  finalized_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  -- Two periods can't cover the same day: that would let HR generate a second
  -- payslip for hours already paid out in the first period's range.
  exclude using gist (daterange(starts_on, ends_on, '[]') with &&)
);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  pay_type public.pay_type not null,
  hours_worked numeric(8,2),
  gross_pay numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  status public.payroll_period_status not null default 'draft',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (payroll_period_id, employee_id)
);

create type public.payslip_line_type as enum ('earning', 'deduction');

create table public.payslip_line_items (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.payslips(id) on delete cascade,
  line_type public.payslip_line_type not null,
  label text not null,
  amount numeric(12,2) not null check (amount >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.employee_compensation enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payslips enable row level security;
alter table public.payslip_line_items enable row level security;

create policy "hr admin read compensation" on public.employee_compensation for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "hr admin insert compensation" on public.employee_compensation for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update compensation" on public.employee_compensation for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete compensation" on public.employee_compensation for delete to authenticated using (public.current_role_is(array['hr_admin']));

create policy "hr admin read payroll periods" on public.payroll_periods for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "hr admin insert payroll periods" on public.payroll_periods for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update payroll periods" on public.payroll_periods for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete payroll periods" on public.payroll_periods for delete to authenticated using (public.current_role_is(array['hr_admin']));

create policy "hr admin read payslips" on public.payslips for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "hr admin insert payslips" on public.payslips for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update payslips" on public.payslips for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete payslips" on public.payslips for delete to authenticated using (public.current_role_is(array['hr_admin']));

create policy "hr admin read payslip line items" on public.payslip_line_items for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "hr admin insert payslip line items" on public.payslip_line_items for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update payslip line items" on public.payslip_line_items for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete payslip line items" on public.payslip_line_items for delete to authenticated using (public.current_role_is(array['hr_admin']));

create or replace function public.upsert_employee_compensation(
  p_employee_id uuid,
  p_pay_type public.pay_type,
  p_monthly_salary numeric default null,
  p_hourly_rate numeric default null,
  p_currency text default 'EUR'
) returns public.employee_compensation language plpgsql security definer set search_path = public as $$
declare
  v_row public.employee_compensation;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can set employee compensation';
  end if;
  if p_pay_type = 'salary' and (p_monthly_salary is null or p_monthly_salary < 0) then
    raise exception 'Enter a monthly salary of 0 or more.';
  end if;
  if p_pay_type = 'hourly' and (p_hourly_rate is null or p_hourly_rate < 0) then
    raise exception 'Enter an hourly rate of 0 or more.';
  end if;

  insert into employee_compensation (employee_id, pay_type, monthly_salary, hourly_rate, currency, updated_at)
  values (
    p_employee_id, p_pay_type,
    case when p_pay_type = 'salary' then p_monthly_salary else null end,
    case when p_pay_type = 'hourly' then p_hourly_rate else null end,
    coalesce(p_currency, 'EUR'), now()
  )
  on conflict (employee_id) do update set
    pay_type = excluded.pay_type,
    monthly_salary = excluded.monthly_salary,
    hourly_rate = excluded.hourly_rate,
    currency = excluded.currency,
    updated_at = now()
  returning * into v_row;
  return v_row;
end; $$;

grant execute on function public.upsert_employee_compensation(uuid, public.pay_type, numeric, numeric, text) to authenticated;

create or replace function public.create_payroll_period(p_label text, p_starts_on date, p_ends_on date)
returns public.payroll_periods language plpgsql security definer set search_path = public as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can create payroll periods';
  end if;
  if p_ends_on < p_starts_on then raise exception 'The period end date must be on or after the start date.'; end if;
  -- Checked explicitly (rather than only relying on the exclusion constraint below)
  -- so the UI gets a readable message instead of a raw constraint-violation error.
  if exists (
    select 1 from payroll_periods
    where daterange(starts_on, ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
  ) then
    raise exception 'This period overlaps an existing payroll period.';
  end if;

  insert into payroll_periods (label, starts_on, ends_on, created_by)
  values (nullif(trim(p_label), ''), p_starts_on, p_ends_on, auth.uid())
  returning * into v_period;
  return v_period;
end; $$;

grant execute on function public.create_payroll_period(text, date, date) to authenticated;

create or replace function public.generate_payroll_period_payslips(p_period_id uuid)
returns setof public.payslips language plpgsql security definer set search_path = public as $$
declare
  v_period public.payroll_periods;
  v_employee record;
  v_hours numeric;
  v_base numeric;
  v_payslip public.payslips;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can generate payslips';
  end if;

  select * into v_period from payroll_periods where id = p_period_id for update;
  if v_period is null then raise exception 'Payroll period not found'; end if;
  if v_period.status <> 'draft' then raise exception 'Payslips can only be generated for a draft period'; end if;

  for v_employee in
    select p.id as employee_id, c.pay_type, c.monthly_salary, c.hourly_rate
    from profiles p
    join employee_compensation c on c.employee_id = p.id
    where p.active
      and not exists (select 1 from payslips where payroll_period_id = p_period_id and employee_id = p.id)
  loop
    if v_employee.pay_type = 'hourly' then
      -- Mirrors the client-side hoursWorked() formula in app/admin/page.tsx:
      -- clock-out minus clock-in, minus break and lunch spans that were both
      -- started and ended. A break/lunch only started (never ended) doesn't
      -- get subtracted, same as the client-side version.
      select coalesce(sum(
        greatest(0,
          extract(epoch from (coalesce(s.clocked_out_at, now()) - s.clocked_in_at)) / 3600.0
          - case when s.first_break_started_at is not null and s.first_break_ended_at is not null
                 then extract(epoch from (s.first_break_ended_at - s.first_break_started_at)) / 3600.0 else 0 end
          - case when s.lunch_started_at is not null and s.lunch_ended_at is not null
                 then extract(epoch from (s.lunch_ended_at - s.lunch_started_at)) / 3600.0 else 0 end
        )
      ), 0) into v_hours
      from attendance_sessions s
      where s.employee_id = v_employee.employee_id
        and s.work_date between v_period.starts_on and v_period.ends_on
        and s.clocked_in_at is not null;
      v_base := round(v_hours * v_employee.hourly_rate, 2);
    else
      v_hours := null;
      v_base := v_employee.monthly_salary;
    end if;

    insert into payslips (payroll_period_id, employee_id, pay_type, hours_worked, gross_pay, net_pay)
    values (p_period_id, v_employee.employee_id, v_employee.pay_type, v_hours, v_base, v_base)
    returning * into v_payslip;

    insert into payslip_line_items (payslip_id, line_type, label, amount, sort_order)
    values (
      v_payslip.id, 'earning',
      case when v_employee.pay_type = 'hourly' then 'Hours worked' else 'Base salary' end,
      v_base, 0
    );

    return next v_payslip;
  end loop;
  return;
end; $$;

grant execute on function public.generate_payroll_period_payslips(uuid) to authenticated;

create or replace function public.recompute_payslip_totals(p_payslip_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_gross numeric;
  v_deductions numeric;
begin
  select coalesce(sum(amount) filter (where line_type = 'earning'), 0),
         coalesce(sum(amount) filter (where line_type = 'deduction'), 0)
    into v_gross, v_deductions
    from payslip_line_items where payslip_id = p_payslip_id;

  update payslips set gross_pay = v_gross, total_deductions = v_deductions, net_pay = v_gross - v_deductions, updated_at = now()
    where id = p_payslip_id;
end; $$;

create or replace function public.add_payslip_line_item(
  p_payslip_id uuid,
  p_line_type public.payslip_line_type,
  p_label text,
  p_amount numeric,
  p_sort_order int default 0
) returns public.payslip_line_items language plpgsql security definer set search_path = public as $$
declare
  v_status public.payroll_period_status;
  v_item public.payslip_line_items;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can edit payslips';
  end if;
  if p_amount < 0 then raise exception 'Amount must be 0 or more.'; end if;

  select pp.status into v_status
    from payslips ps join payroll_periods pp on pp.id = ps.payroll_period_id
    where ps.id = p_payslip_id;
  if v_status is null then raise exception 'Payslip not found'; end if;
  if v_status <> 'draft' then raise exception 'Cannot edit a finalized payroll period.'; end if;

  insert into payslip_line_items (payslip_id, line_type, label, amount, sort_order)
  values (p_payslip_id, p_line_type, nullif(trim(p_label), ''), p_amount, coalesce(p_sort_order, 0))
  returning * into v_item;

  perform public.recompute_payslip_totals(p_payslip_id);
  return v_item;
end; $$;

grant execute on function public.add_payslip_line_item(uuid, public.payslip_line_type, text, numeric, int) to authenticated;

create or replace function public.delete_payslip_line_item(p_line_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_payslip_id uuid;
  v_status public.payroll_period_status;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can edit payslips';
  end if;

  select li.payslip_id, pp.status into v_payslip_id, v_status
    from payslip_line_items li
    join payslips ps on ps.id = li.payslip_id
    join payroll_periods pp on pp.id = ps.payroll_period_id
    where li.id = p_line_item_id;
  if v_payslip_id is null then raise exception 'Line item not found'; end if;
  if v_status <> 'draft' then raise exception 'Cannot edit a finalized payroll period.'; end if;

  delete from payslip_line_items where id = p_line_item_id;
  perform public.recompute_payslip_totals(v_payslip_id);
end; $$;

grant execute on function public.delete_payslip_line_item(uuid) to authenticated;

create or replace function public.finalize_payroll_period(p_period_id uuid)
returns public.payroll_periods language plpgsql security definer set search_path = public as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can finalize a payroll period';
  end if;

  select * into v_period from payroll_periods where id = p_period_id for update;
  if v_period is null then raise exception 'Payroll period not found'; end if;
  if v_period.status <> 'draft' then raise exception 'Only a draft period can be finalized.'; end if;
  if not exists (select 1 from payslips where payroll_period_id = p_period_id) then
    raise exception 'Generate payslips before finalizing this period.';
  end if;

  update payroll_periods set status = 'finalized', finalized_by = auth.uid(), finalized_at = now()
    where id = p_period_id returning * into v_period;
  update payslips set status = 'finalized', updated_at = now() where payroll_period_id = p_period_id;
  return v_period;
end; $$;

grant execute on function public.finalize_payroll_period(uuid) to authenticated;

create or replace function public.mark_payroll_period_paid(p_period_id uuid)
returns public.payroll_periods language plpgsql security definer set search_path = public as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can mark a payroll period paid';
  end if;

  select * into v_period from payroll_periods where id = p_period_id for update;
  if v_period is null then raise exception 'Payroll period not found'; end if;
  if v_period.status <> 'finalized' then raise exception 'Only a finalized period can be marked paid.'; end if;

  update payroll_periods set status = 'paid', paid_at = now() where id = p_period_id returning * into v_period;
  update payslips set status = 'paid', updated_at = now() where payroll_period_id = p_period_id;
  return v_period;
end; $$;

grant execute on function public.mark_payroll_period_paid(uuid) to authenticated;
