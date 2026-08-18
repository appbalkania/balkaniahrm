-- Irish bank holidays: a real holidays table (auto-seeded with the standard
-- calendar for the current + next year, HR-editable afterward), and a check
-- that blocks leave requests overlapping a bank holiday.

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.holidays enable row level security;

create policy "authenticated read holidays" on public.holidays for select to authenticated using (true);
create policy "hr admin insert holidays" on public.holidays for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update holidays" on public.holidays for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete holidays" on public.holidays for delete to authenticated using (public.current_role_is(array['hr_admin']));

-- Easter Sunday via the standard Meeus/Jones/Butcher algorithm.
create or replace function public._easter_sunday(p_year int)
returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; da int;
begin
  a := p_year % 19; b := p_year / 100; c := p_year % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19*a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2*e + 2*i - h - k) % 7; m := (a + 11*h + 22*l) / 451;
  mo := (h + l - 7*m + 114) / 31; da := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(p_year, mo, da);
end; $$;

create or replace function public._nth_monday(p_year int, p_month int, p_n int)
returns date language sql immutable as $$
  select d::date from generate_series(
    make_date(p_year, p_month, 1),
    (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date,
    interval '1 day'
  ) as d
  where extract(isodow from d) = 1
  order by d offset (p_n - 1) limit 1;
$$;

create or replace function public._last_monday(p_year int, p_month int)
returns date language sql immutable as $$
  select d::date from generate_series(
    make_date(p_year, p_month, 1),
    (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date,
    interval '1 day'
  ) as d
  where extract(isodow from d) = 1
  order by d desc limit 1;
$$;

-- Unrestricted -- called both by the migration itself (no auth context) and
-- by the public wrapper below. Revoked from PUBLIC so it can't be called
-- directly and bypass the wrapper's hr_admin check.
create or replace function public._seed_irish_holidays_for_year(p_year int)
returns void language plpgsql set search_path = public as $$
declare
  v_easter date := public._easter_sunday(p_year);
  v_feb1 date := make_date(p_year, 2, 1);
  v_brigid date := case when extract(isodow from v_feb1) = 5 then v_feb1 else public._nth_monday(p_year, 2, 1) end;
begin
  insert into holidays (holiday_date, name) values
    (make_date(p_year,1,1), 'New Year''s Day'),
    (v_brigid, 'St. Brigid''s Day'),
    (make_date(p_year,3,17), 'St. Patrick''s Day'),
    (v_easter + 1, 'Easter Monday'),
    (public._nth_monday(p_year,5,1), 'May Bank Holiday'),
    (public._nth_monday(p_year,6,1), 'June Bank Holiday'),
    (public._nth_monday(p_year,8,1), 'August Bank Holiday'),
    (public._last_monday(p_year,10), 'October Bank Holiday'),
    (make_date(p_year,12,25), 'Christmas Day'),
    (make_date(p_year,12,26), 'St. Stephen''s Day')
  on conflict (holiday_date) do nothing;
end; $$;
revoke all on function public._seed_irish_holidays_for_year(int) from public;

-- hr_admin-callable wrapper, exposed so HR can seed further-out years later
-- from the admin UI without needing another migration.
create or replace function public.seed_irish_bank_holidays(p_year int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can manage holidays';
  end if;
  perform public._seed_irish_holidays_for_year(p_year);
end; $$;
grant execute on function public.seed_irish_bank_holidays(int) to authenticated;

-- Seed current year + next year immediately.
select public._seed_irish_holidays_for_year(extract(year from current_date)::int);
select public._seed_irish_holidays_for_year(extract(year from current_date)::int + 1);

-- Block leave requests that overlap a bank holiday, on top of the existing
-- balance check.
create or replace function public.validate_leave_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_requested_days numeric;
  v_available numeric;
  v_holiday record;
begin
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
