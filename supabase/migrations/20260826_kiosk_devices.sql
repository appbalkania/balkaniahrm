-- Real kiosk device registration. attendance_devices previously had only a
-- SELECT policy for hr_admin (no way to write at all), and the admin UI's
-- "Register kiosk" / "Regenerate PIN" buttons were placeholders. PINs are
-- generated and hashed server-side (bcrypt via pgcrypto, already enabled in
-- 20260816_attendance_core.sql) and returned to the caller exactly once —
-- only the hash is ever persisted.

create or replace function public.register_attendance_device(p_label text)
returns table(id uuid, label text, pin text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_label text := trim(coalesce(p_label, ''));
  v_pin text;
  v_id uuid;
begin
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can register kiosk devices';
  end if;
  if length(v_label) = 0 then
    raise exception 'A device label is required';
  end if;

  v_pin := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into attendance_devices (label, pin_hash)
  values (v_label, crypt(v_pin, gen_salt('bf')))
  returning attendance_devices.id into v_id;

  return query select v_id, v_label, v_pin;
end; $$;

grant execute on function public.register_attendance_device(text) to authenticated;

create or replace function public.regenerate_device_pin(p_device_id uuid)
returns table(pin text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pin text;
begin
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can manage kiosk devices';
  end if;

  v_pin := lpad(floor(random() * 1000000)::text, 6, '0');

  update attendance_devices set pin_hash = crypt(v_pin, gen_salt('bf')) where id = p_device_id;
  if not found then raise exception 'Kiosk device not found'; end if;

  return query select v_pin;
end; $$;

grant execute on function public.regenerate_device_pin(uuid) to authenticated;

create or replace function public.set_device_active(p_device_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can manage kiosk devices';
  end if;
  update attendance_devices set active = p_active where id = p_device_id;
  if not found then raise exception 'Kiosk device not found'; end if;
end; $$;

grant execute on function public.set_device_active(uuid, boolean) to authenticated;
