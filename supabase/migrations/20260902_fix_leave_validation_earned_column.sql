-- 20260828_bank_holidays.sql and 20260830_employee_deactivation.sql each
-- re-defined validate_leave_request() by building on the pre-accrual version
-- from 20260824, not the corrected one from 20260825 -- so both silently
-- undid 20260825's fix and brought back a reference to leave_balances.earned,
-- a column that no longer exists (dropped in favor of the live-computed
-- value in leave_balances_current). Every leave request has been failing with
-- "column earned does not exist" since. This re-defines the function once
-- more, keeping the bank-holiday and deactivated-employee checks from those
-- two migrations but restoring the live, leave-year-scoped accrual calculation
-- from 20260825.
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
    round(entitlement * least(12, greatest(0,
      (extract(year from current_date) - extract(year from leave_year_start)) * 12
      + (extract(month from current_date) - extract(month from leave_year_start)) + 1
    )) / 12.0, 2),
    used
  into v_earned, v_used
  from leave_balances
  where employee_id = new.employee_id and leave_type = new.leave_type
    and leave_year_start = public.current_leave_year_start();

  if v_earned is null then
    raise exception 'No % leave balance is set up for you yet. Ask HR to set your entitlement before requesting this leave type.', new.leave_type;
  end if;

  if v_requested_days > (v_earned - coalesce(v_used, 0)) then
    raise exception 'This request is % days, but only % days of % leave are available to book.', v_requested_days, (v_earned - coalesce(v_used, 0)), new.leave_type;
  end if;

  return new;
end; $$;
