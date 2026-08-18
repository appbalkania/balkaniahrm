-- Sensitive personal details (PPS number, DOB, phone, address, place of
-- birth), kept out of the broadly-readable `profiles` table since managers
-- read `profiles` for their team but should not see this data. Only HR
-- admin can write; HR admin + the employee themselves can read.
create table public.employee_details (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  pps_number text,
  date_of_birth date,
  phone_number text,
  address text,
  place_of_birth text,
  updated_at timestamptz not null default now()
);
alter table public.employee_details enable row level security;

create policy "self read own details" on public.employee_details for select to authenticated using (employee_id = auth.uid());
create policy "hr admin read all details" on public.employee_details for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "hr admin insert details" on public.employee_details for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update details" on public.employee_details for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete details" on public.employee_details for delete to authenticated using (public.current_role_is(array['hr_admin']));

-- Auto-generated employee codes (EMP0001, EMP0002, ...). Seeded past any
-- existing EMP####-pattern codes so it can't collide with historical ones.
create sequence public.employee_code_seq;

select setval(
  'public.employee_code_seq',
  coalesce((select max(substring(employee_code from '\d+')::int) from public.profiles where employee_code ~ '^EMP\d+$'), 0) + 1,
  false
);

create or replace function public.assign_employee_code()
returns trigger language plpgsql as $$
begin
  if new.employee_code is null or new.employee_code = '' then
    new.employee_code := 'EMP' || lpad(nextval('public.employee_code_seq')::text, 4, '0');
  end if;
  return new;
end; $$;

create trigger profiles_assign_employee_code
  before insert on public.profiles
  for each row execute function public.assign_employee_code();
