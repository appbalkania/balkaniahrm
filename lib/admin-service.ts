import { createSupabaseBrowserClient } from "./supabase";

function client() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function listEmployees() {
  const { data, error } = await client().from("profiles").select("id,full_name,employee_code,role").order("full_name");
  if (error) throw error;
  return data;
}

export async function listPendingLeaveRequests() {
  const { data, error } = await client().from("leave_requests").select("id,leave_type,starts_on,ends_on,status,profiles!leave_requests_employee_id_fkey(full_name)").eq("status", "pending").order("created_at");
  if (error) throw error;
  return data;
}

export async function reviewLeaveRequest(id: string, status: "approved" | "rejected", comment?: string) {
  const { data, error } = await client().rpc("review_leave_request", { p_request_id: id, p_status: status, p_comment: comment ?? null });
  if (error) throw error;
  return data;
}

export async function listAttendanceSessions(workDate: string) {
  const { data, error } = await client().from("attendance_sessions").select("*,profiles!attendance_sessions_employee_id_fkey(full_name,employee_code)").eq("work_date", workDate).order("clocked_in_at");
  if (error) throw error;
  return data;
}
