import type { AttendanceEventInput, AttendanceSession } from "./domain";
import { createSupabaseBrowserClient } from "./supabase";

export async function recordAttendance(input: AttendanceEventInput): Promise<AttendanceSession> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured. Add the public project URL and anon key first.");
  const { data, error } = await supabase.rpc("record_attendance_event", {
    p_event_type: input.eventType,
    p_idempotency_key: input.idempotencyKey,
    p_source: input.source,
    p_work_mode: input.workMode ?? null,
    p_location: input.latitude == null ? null : { latitude: input.latitude, longitude: input.longitude },
  });
  if (error) throw error;
  return data as AttendanceSession;
}
