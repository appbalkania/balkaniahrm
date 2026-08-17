-- Ireland leave-year model: entitlement accrues monthly (1/12 credited on the
-- 1st of each month) across an Apr 1 - Mar 31 leave year, and unused balance
-- is forfeited (not carried over) when the year resets. Each leave year gets
-- its own leave_balances row (keyed on leave_year_start) so history is kept
-- rather than overwritten, and "earned" is computed live from entitlement +
-- elapsed months rather than stored, so there's no accrual cron job that can
-- drift, fail silently, or need timezone handling.

create or replace function public.current_leave_year_start()
returns date language sql stable as $$
  select case
    when extract(month from current_date) >= 4
      then make_date(extract(year from current_date)::int, 4, 1)
    else make_date(extract(year from current_date)::int - 1, 4, 1)
  end;
$$;

alter table public.leave_balances add column leave_year_start date not null default public.current_leave_year_start();

alter table public.leave_balances drop constraint leave_balances_employee_id_leave_type_key;
alter table public.leave_balances add constraint leave_balances_employee_id_leave_type_year_key unique (employee_id, leave_type, leave_year_start);

-- Superseded by the live-computed "earned" in leave_balances_current below.
alter table public.leave_balances drop column earned;

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
      (extract(year from current_date) - extract(year from lb.leave_year_start)) * 12
      + (extract(month from current_date) - extract(month from lb.leave_year_start)) + 1
    )) / 12.0,
  2) as earned
from public.leave_balances lb
where lb.leave_year_start = public.current_leave_year_start();

grant select on public.leave_balances_current to authenticated;

-- Must only touch the current leave year's row — without this, approving a
-- request after a leave-year reset could increment "used" on a stale,
-- historical row (or none at all) instead of the active one.
create or replace function public.review_leave_request(p_request_id uuid, p_status public.leave_request_status, p_comment text default null)
returns public.leave_requests language plpgsql security definer set search_path = public as $$
declare
  v_request public.leave_requests;
  v_employee uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Only approvals or rejections are allowed'; end if;

  select employee_id into v_employee from leave_requests where id = p_request_id;
  if v_employee is null then raise exception 'Leave request is unavailable or already reviewed'; end if;
  if not (public.current_role_is(array['hr_admin']) or public.is_manager_of(v_employee)) then
    raise exception 'Not authorized to review this request';
  end if;

  update leave_requests set status = p_status where id = p_request_id and status = 'pending' returning * into v_request;
  if v_request is null then raise exception 'Leave request is unavailable or already reviewed'; end if;
  if p_status = 'approved' then
    update leave_balances set used = used + (v_request.ends_on - v_request.starts_on + 1)
      where employee_id = v_request.employee_id and leave_type = v_request.leave_type
        and leave_year_start = public.current_leave_year_start();
  end if;
  return v_request;
end; $$;

-- Re-points the balance-validation trigger from 20260824 at the live accrual
-- formula (scoped to the current leave year) instead of the now-removed
-- stored "earned" column.
create or replace function public.validate_leave_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_requested_days numeric;
  v_earned numeric;
  v_used numeric;
begin
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
