import type { AttendanceEventType, AttendanceSession, AttendanceState } from "./domain";
import { createSupabaseBrowserClient } from "./supabase";

function client() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

const STORAGE_KEY = "balkania.kiosk.session";

export interface KioskSession {
  deviceId: string;
  deviceLabel: string;
  sessionToken: string;
  pairedAt: string;
}

export function saveKioskSession(session: KioskSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadKioskSession(): KioskSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as KioskSession;
  } catch {
    return null;
  }
}

export function clearKioskSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

const SESSION_INVALID_PREFIX = "KIOSK_SESSION_INVALID:";

export function isKioskSessionInvalidError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(SESSION_INVALID_PREFIX);
}

export function kioskErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.startsWith(SESSION_INVALID_PREFIX) ? error.message.slice(SESSION_INVALID_PREFIX.length).trim() : error.message;
  }
  return "Something went wrong.";
}

export async function pairDevice(pin: string): Promise<KioskSession> {
  const { data, error } = await client().rpc("pair_attendance_device", { p_pin: pin });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { deviceId: row.device_id, deviceLabel: row.device_label, sessionToken: row.session_token, pairedAt: new Date().toISOString() };
}

export interface IdentifiedEmployee {
  employeeId: string;
  fullName: string;
  employeeCode: string;
  state: AttendanceState;
  validActions: AttendanceEventType[];
}

export async function identifyEmployee(sessionToken: string, qrToken: string): Promise<IdentifiedEmployee> {
  const { data, error } = await client().rpc("kiosk_identify_employee", { p_session_token: sessionToken, p_qr_token: qrToken });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { employeeId: row.employee_id, fullName: row.full_name, employeeCode: row.employee_code, state: row.state, validActions: row.valid_actions };
}

export async function recordKioskAttendance(sessionToken: string, employeeId: string, eventType: AttendanceEventType, idempotencyKey: string): Promise<AttendanceSession> {
  const { data, error } = await client().rpc("record_kiosk_attendance_event", {
    p_session_token: sessionToken,
    p_employee_id: employeeId,
    p_event_type: eventType,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    employeeId: row.employee_id,
    workDate: row.work_date,
    state: row.state,
    clockedInAt: row.clocked_in_at ?? undefined,
    clockedOutAt: row.clocked_out_at ?? undefined,
    firstBreakStartedAt: row.first_break_started_at ?? undefined,
    firstBreakEndedAt: row.first_break_ended_at ?? undefined,
    lunchStartedAt: row.lunch_started_at ?? undefined,
    lunchEndedAt: row.lunch_ended_at ?? undefined,
  };
}
