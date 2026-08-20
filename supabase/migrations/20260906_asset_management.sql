-- Asset Management: company equipment (laptops, phones, vehicles, tools,
-- uniforms) and who currently holds each item. Assignment history is kept
-- rather than overwritten so "who had this laptop in March" stays answerable
-- after the item is reassigned.
--
-- Follows the disciplinary_actions pattern: reads are governed by RLS policies,
-- but the state-changing operations (assign/return) go through security definer
-- functions so authorization, the assigned_by stamp, and keeping assets.status
-- in step with the assignment rows all live in one trusted place.

create type public.asset_category as enum ('laptop', 'phone', 'vehicle', 'tool', 'uniform', 'other');
create type public.asset_status as enum ('available', 'assigned', 'retired');

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_tag text not null unique,
  name text not null,
  category public.asset_category not null default 'other',
  serial_number text,
  notes text,
  status public.asset_status not null default 'available',
  created_at timestamptz not null default now()
);

create table public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_on date not null default current_date,
  returned_on date,
  notes text,
  created_at timestamptz not null default now()
);

-- An asset can only be out with one person at a time. Partial index so any
-- number of past (returned) assignments are still allowed per asset.
create unique index asset_assignments_one_active_idx
  on public.asset_assignments (asset_id) where returned_on is null;

create index asset_assignments_employee_idx on public.asset_assignments (employee_id);

alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;

-- Every signed-in user can see the asset catalogue itself (needed to render an
-- employee's own assigned item, and harmless -- it holds no personal data).
create policy "authenticated read assets" on public.assets
  for select to authenticated using (true);
create policy "hr admin insert assets" on public.assets
  for insert to authenticated with check (public.current_role_is(array['hr_admin']));
create policy "hr admin update assets" on public.assets
  for update to authenticated using (public.current_role_is(array['hr_admin'])) with check (public.current_role_is(array['hr_admin']));
create policy "hr admin delete assets" on public.assets
  for delete to authenticated using (public.current_role_is(array['hr_admin']));

create policy "employees read own asset assignments" on public.asset_assignments
  for select to authenticated using (employee_id = auth.uid());
create policy "hr admin reads all asset assignments" on public.asset_assignments
  for select to authenticated using (public.current_role_is(array['hr_admin']));
create policy "managers read their reports asset assignments" on public.asset_assignments
  for select to authenticated using (public.is_manager_of(employee_id));

create or replace function public.assign_asset(
  p_asset_id uuid,
  p_employee_id uuid,
  p_notes text default null,
  p_assigned_on date default current_date
) returns public.asset_assignments language plpgsql security definer set search_path = public as $$
declare
  v_assignment public.asset_assignments;
  v_status public.asset_status;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can assign assets';
  end if;

  select status into v_status from assets where id = p_asset_id for update;
  if v_status is null then raise exception 'Asset not found'; end if;
  if v_status = 'retired' then raise exception 'This asset is retired and cannot be assigned.'; end if;
  if exists (select 1 from asset_assignments where asset_id = p_asset_id and returned_on is null) then
    raise exception 'This asset is already assigned. Mark it returned before reassigning.';
  end if;

  if not exists (select 1 from profiles where id = p_employee_id and active) then
    raise exception 'That employee is not active.';
  end if;

  insert into asset_assignments (asset_id, employee_id, assigned_by, assigned_on, notes)
  values (p_asset_id, p_employee_id, auth.uid(), coalesce(p_assigned_on, current_date), nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_assignment;

  update assets set status = 'assigned' where id = p_asset_id;
  return v_assignment;
end; $$;

grant execute on function public.assign_asset(uuid, uuid, text, date) to authenticated;

create or replace function public.return_asset(p_asset_id uuid, p_returned_on date default current_date)
returns public.asset_assignments language plpgsql security definer set search_path = public as $$
declare
  v_assignment public.asset_assignments;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can record asset returns';
  end if;

  update asset_assignments set returned_on = coalesce(p_returned_on, current_date)
    where asset_id = p_asset_id and returned_on is null
    returning * into v_assignment;
  if v_assignment is null then raise exception 'This asset is not currently assigned.'; end if;

  -- A retired asset stays retired once handed back; only in-service items
  -- return to the available pool.
  update assets set status = 'available' where id = p_asset_id and status <> 'retired';
  return v_assignment;
end; $$;

grant execute on function public.return_asset(uuid, date) to authenticated;
