-- HR could register, re-PIN, and deactivate kiosk devices but never remove one,
-- so retired or mistakenly-created tablets stayed in the list forever.
-- attendance_devices has no write policies at all (every mutation goes through
-- a security definer RPC), so deletion needs its own function rather than a
-- table policy.

create or replace function public.delete_attendance_device(p_device_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is(array['hr_admin']) then
    raise exception 'Only HR administrators can manage kiosk devices';
  end if;

  -- kiosk_pairing_attempts.device_id references this row. Those rows drive the
  -- global pairing rate limiter, so they're detached rather than deleted --
  -- removing a device must not hand an attacker a way to clear the failure
  -- history that's throttling them.
  update kiosk_pairing_attempts set device_id = null where device_id = p_device_id;

  delete from attendance_devices where id = p_device_id;
  if not found then raise exception 'Kiosk device not found'; end if;
end; $$;

grant execute on function public.delete_attendance_device(uuid) to authenticated;
