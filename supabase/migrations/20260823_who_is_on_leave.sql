-- Employee dashboard needs to show who's on leave today, but employees can
-- only read their own leave_requests rows (and a request's `note` can hold a
-- private reason). Rather than widen the RLS policy and expose everyone's full
-- leave request details to every employee, expose just the minimal safe slice
-- (name + leave type, for approved requests covering today) via a function.

create or replace function public.who_is_on_leave_today()
returns table(employee_name text, leave_type text)
language sql stable security definer set search_path = public as $$
  select p.full_name, lr.leave_type
  from leave_requests lr
  join profiles p on p.id = lr.employee_id
  where lr.status = 'approved' and current_date between lr.starts_on and lr.ends_on
  order by p.full_name;
$$;

grant execute on function public.who_is_on_leave_today() to authenticated;
