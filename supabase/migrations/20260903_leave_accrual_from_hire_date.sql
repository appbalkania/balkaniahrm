-- Leave accrual was computed purely from the company-wide leave year start
-- (Apr 1), with no notion of when the individual employee actually joined.
-- A new hire added mid-year would immediately show months of "earned"
-- leave they never worked for. This adds a per-employee start_date and
-- anchors accrual there instead, once it's later than the leave year start.
-- The hire month itself doesn't count -- accrual begins the 1st of the
-- month following start_date, same as a probation-style policy, so someone
-- hired today shows 0 earned days until next month, not a partial credit
-- for today. Existing employees are backfilled from profiles.created_at
-- (the closest existing proxy for when they joined) -- correct these via
-- Admin -> Employees -> Edit once real hire dates are known; the backfill
-- is only a placeholder.

alter table public.profiles add column start_date date;
update public.profiles set start_date = created_at::date where start_date is null;
alter table public.profiles alter column start_date set not null;
alter table public.profiles alter column start_date set default current_date;

-- Returns the date accrual should be counted from: the leave year start,
-- unless the employee's own start date pushes it later, in which case
-- accrual begins the 1st of the month *after* they started (their first,
-- partial month earns nothing).
create or replace function public.leave_accrual_anchor(p_leave_year_start date, p_start_date date)
returns date language sql immutable as $$
  select greatest(p_leave_year_start, (date_trunc('month', p_start_date) + interval '1 month')::date);
$$;

create or replace view public.leave_balances_current as
select
  lb.id,
  lb.employee_id,
  lb.leave_type,
  lb.entitlement,
  lb.used,
  lb.leave_year_start,
  round(
    lb.entitlement * least(12, greatest(0,
      (extract(year from current_date) - extract(year from public.leave_accrual_anchor(lb.leave_year_start, p.start_date))) * 12
      + (extract(month from current_date) - extract(month from public.leave_accrual_anchor(lb.leave_year_start, p.start_date))) + 1
    )) / 12.0,
  2) as earned
from public.leave_balances lb
join public.profiles p on p.id = lb.employee_id
where lb.leave_year_start = public.current_leave_year_start();

create or replace function public.validate_leave_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_requested_days numeric;
  v_earned numeric;
  v_used numeric;
  v_holiday record;
begin
  if not exists (select 1 from profiles where id = new.employee_id and active) then
    raise exception 'This employee account is deactivated.';
  end if;

  select holiday_date, name into v_holiday from holidays
    where holiday_date between new.starts_on and new.ends_on
    order by holiday_date limit 1;
  if v_holiday.holiday_date is not null then
    raise exception 'This date range includes % (%), which is already a bank holiday.', v_holiday.name, to_char(v_holiday.holiday_date, 'DD Mon YYYY');
  end if;

  if new.leave_type = 'unpaid' then
    return new;
  end if;

  v_requested_days := (new.ends_on - new.starts_on + 1);

  select
    round(lb.entitlement * least(12, greatest(0,
      (extract(year from current_date) - extract(year from public.leave_accrual_anchor(lb.leave_year_start, p.start_date))) * 12
      + (extract(month from current_date) - extract(month from public.leave_accrual_anchor(lb.leave_year_start, p.start_date))) + 1
    )) / 12.0, 2),
    lb.used
  into v_earned, v_used
  from leave_balances lb
  join profiles p on p.id = lb.employee_id
  where lb.employee_id = new.employee_id and lb.leave_type = new.leave_type
    and lb.leave_year_start = public.current_leave_year_start();

  if v_earned is null then
    raise exception 'No % leave balance is set up for you yet. Ask HR to set your entitlement before requesting this leave type.', new.leave_type;
  end if;

  if v_requested_days > (v_earned - coalesce(v_used, 0)) then
    raise exception 'This request is % days, but only % days of % leave are available to book.', v_requested_days, (v_earned - coalesce(v_used, 0)), new.leave_type;
  end if;

  return new;
end; $$;
