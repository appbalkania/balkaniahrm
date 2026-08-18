-- Nothing stopped a leave request from exceeding the employee's available
-- balance (e.g. a 31-day request against a 20-day annual entitlement).
-- AVEHR_DEVELOPMENT_GUIDE.md calls this out explicitly: "Prevent a request
-- from exceeding available balance ... return a helpful explanation." This
-- adds that as a trigger so it's enforced for every insert path, not just
-- whatever the client happens to check.

create or replace function public.validate_leave_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_requested_days numeric;
  v_available numeric;
begin
  -- Unpaid leave doesn't draw from an entitled balance by definition.
  if new.leave_type = 'unpaid' then
    return new;
  end if;

  v_requested_days := (new.ends_on - new.starts_on + 1);

  select coalesce(earned, 0) - coalesce(used, 0) into v_available
  from leave_balances
  where employee_id = new.employee_id and leave_type = new.leave_type;

  if v_available is null then
    raise exception 'No % leave balance is set up for you yet. Ask HR to set your entitlement before requesting this leave type.', new.leave_type;
  end if;

  if v_requested_days > v_available then
    raise exception 'This request is % days, but only % days of % leave are available to book.', v_requested_days, v_available, new.leave_type;
  end if;

  return new;
end; $$;

drop trigger if exists leave_request_balance_check on public.leave_requests;
create trigger leave_request_balance_check
  before insert on public.leave_requests
  for each row execute function public.validate_leave_request();
