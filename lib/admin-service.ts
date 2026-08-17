import { createSupabaseBrowserClient } from "./supabase";

function client() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function unwrapFunctionError(error: { name?: string; message: string; context?: Response }): Promise<never> {
  if (error.name === "FunctionsFetchError") {
    throw new Error("Couldn't reach the server function. It may not be deployed to this Supabase project yet — see the setup notes for how to deploy it.");
  }
  const body = await error.context?.json?.().catch(() => null);
  throw new Error(body?.error ?? error.message);
}

export interface AdminEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
  role: string;
  teamId: string | null;
  teamName: string | null;
}

export async function listEmployees(): Promise<AdminEmployee[]> {
  const { data, error } = await client()
    .from("profiles")
    .select("id,full_name,employee_code,role,team_id,teams!profiles_team_id_fkey(name)")
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    return {
      id: row.id,
      fullName: row.full_name,
      employeeCode: row.employee_code,
      role: row.role,
      teamId: row.team_id,
      teamName: team?.name ?? null,
    };
  });
}

export interface CreateEmployeeInput {
  fullName: string;
  email: string;
  employeeCode: string;
  role: string;
  teamId?: string | null;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<AdminEmployee> {
  const { data, error } = await client().functions.invoke("create-employee", {
    body: {
      fullName: input.fullName,
      email: input.email,
      employeeCode: input.employeeCode,
      role: input.role,
      teamId: input.teamId || null,
    },
  });
  if (error) return unwrapFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return { id: data.id, fullName: data.fullName, employeeCode: data.employeeCode, role: data.role, teamId: data.teamId ?? null, teamName: null };
}

export interface UpdateEmployeeInput {
  id: string;
  fullName: string;
  employeeCode: string;
  role: string;
  teamId?: string | null;
}

export async function updateEmployee(input: UpdateEmployeeInput): Promise<AdminEmployee> {
  const { data, error } = await client()
    .from("profiles")
    .update({ full_name: input.fullName, employee_code: input.employeeCode, role: input.role, team_id: input.teamId || null })
    .eq("id", input.id)
    .select("id,full_name,employee_code,role,team_id,teams!profiles_team_id_fkey(name)")
    .single();
  if (error) throw error;
  const team = Array.isArray(data.teams) ? data.teams[0] : data.teams;
  return {
    id: data.id,
    fullName: data.full_name,
    employeeCode: data.employee_code,
    role: data.role,
    teamId: data.team_id,
    teamName: team?.name ?? null,
  };
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  const { data, error } = await client().functions.invoke("delete-employee", { body: { employeeId } });
  if (error) return unwrapFunctionError(error);
  if (data?.error) throw new Error(data.error);
}

export interface AdminManagerOption {
  id: string;
  fullName: string;
}

export async function listManagers(): Promise<AdminManagerOption[]> {
  const { data, error } = await client()
    .from("profiles")
    .select("id,full_name")
    .in("role", ["manager", "hr_admin"])
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, fullName: row.full_name }));
}

export interface AdminTeam {
  id: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
}

export async function listTeams(): Promise<AdminTeam[]> {
  const { data, error } = await client()
    .from("teams")
    .select("id,name,manager_id,profiles!teams_manager_id_fkey(full_name)")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const manager = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return { id: row.id, name: row.name, managerId: row.manager_id, managerName: manager?.full_name ?? null };
  });
}

export interface CreateTeamInput {
  name: string;
  managerId?: string | null;
}

export async function createTeam(input: CreateTeamInput): Promise<AdminTeam> {
  const { data, error } = await client()
    .from("teams")
    .insert({ name: input.name, manager_id: input.managerId || null })
    .select("id,name,manager_id")
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, managerId: data.manager_id, managerName: null };
}

export interface UpdateTeamInput {
  id: string;
  name: string;
  managerId?: string | null;
}

export async function updateTeam(input: UpdateTeamInput): Promise<AdminTeam> {
  const { data, error } = await client()
    .from("teams")
    .update({ name: input.name, manager_id: input.managerId || null })
    .eq("id", input.id)
    .select("id,name,manager_id")
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, managerId: data.manager_id, managerName: null };
}

export interface AdminLeaveRequest {
  id: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  status: string;
  employeeName: string;
}

export async function listPendingLeaveRequests(): Promise<AdminLeaveRequest[]> {
  const { data, error } = await client()
    .from("leave_requests")
    .select("id,leave_type,starts_on,ends_on,status,profiles!leave_requests_employee_id_fkey(full_name)")
    .eq("status", "pending")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      leaveType: row.leave_type,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      status: row.status,
      employeeName: profile?.full_name ?? "Unknown",
    };
  });
}

export async function reviewLeaveRequest(id: string, status: "approved" | "rejected", comment?: string) {
  const { data, error } = await client().rpc("review_leave_request", { p_request_id: id, p_status: status, p_comment: comment ?? null });
  if (error) throw error;
  return data;
}

export interface AdminLeaveBalance {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  entitlement: number;
  earned: number;
  used: number;
}

export async function listLeaveBalances(): Promise<AdminLeaveBalance[]> {
  const { data, error } = await client()
    .from("leave_balances")
    .select("id,employee_id,leave_type,entitlement,earned,used,profiles!leave_balances_employee_id_fkey(full_name)")
    .order("leave_type");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      employeeId: row.employee_id,
      employeeName: profile?.full_name ?? "Unknown",
      leaveType: row.leave_type,
      entitlement: Number(row.entitlement),
      earned: Number(row.earned),
      used: Number(row.used),
    };
  });
}

export interface SetLeaveEntitlementInput {
  employeeId: string;
  leaveType: string;
  entitlement: number;
}

export async function setLeaveEntitlement(input: SetLeaveEntitlementInput): Promise<void> {
  const { error } = await client()
    .from("leave_balances")
    .upsert({ employee_id: input.employeeId, leave_type: input.leaveType, entitlement: input.entitlement }, { onConflict: "employee_id,leave_type" });
  if (error) throw error;
}

export interface AdminAttendanceSession {
  id: string;
  state: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  employeeName: string;
  employeeCode: string;
}

export async function listAttendanceSessions(workDate: string): Promise<AdminAttendanceSession[]> {
  const { data, error } = await client()
    .from("attendance_sessions")
    .select("id,state,clocked_in_at,clocked_out_at,profiles!attendance_sessions_employee_id_fkey(full_name,employee_code)")
    .eq("work_date", workDate)
    .order("clocked_in_at");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      state: row.state,
      clockedInAt: row.clocked_in_at,
      clockedOutAt: row.clocked_out_at,
      employeeName: profile?.full_name ?? "Unknown",
      employeeCode: profile?.employee_code ?? "",
    };
  });
}

export interface AdminWorkSchedule {
  id: string;
  name: string;
  branchName: string | null;
  startsAt: string;
  endsAt: string;
  isDefault: boolean;
}

export async function listWorkSchedules(): Promise<AdminWorkSchedule[]> {
  const { data, error } = await client().from("work_schedules").select("id,name,branch_name,starts_at,ends_at,is_default").order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, branchName: row.branch_name, startsAt: row.starts_at, endsAt: row.ends_at, isDefault: row.is_default }));
}

export async function listAttendanceDevices() {
  const { data, error } = await client().from("attendance_devices").select("id,label,active,created_at").order("created_at");
  if (error) throw error;
  return data ?? [];
}

export type DisciplinarySeverity = "verbal_warning" | "written_warning" | "final_warning" | "suspension" | "termination_notice";

export interface AdminDisciplinaryAction {
  id: string;
  employeeName: string;
  employeeCode: string;
  severity: DisciplinarySeverity;
  reason: string;
  details: string | null;
  occurredOn: string;
}

export async function listDisciplinaryActions(): Promise<AdminDisciplinaryAction[]> {
  const { data, error } = await client()
    .from("disciplinary_actions")
    .select("id,severity,reason,details,occurred_on,profiles!disciplinary_actions_employee_id_fkey(full_name,employee_code)")
    .order("occurred_on", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      employeeName: profile?.full_name ?? "Unknown",
      employeeCode: profile?.employee_code ?? "",
      severity: row.severity,
      reason: row.reason,
      details: row.details,
      occurredOn: row.occurred_on,
    };
  });
}

export interface IssueDisciplinaryInput {
  employeeId: string;
  severity: DisciplinarySeverity;
  reason: string;
  details?: string;
  occurredOn: string;
}

export async function issueDisciplinaryAction(input: IssueDisciplinaryInput): Promise<void> {
  const { error } = await client().rpc("issue_disciplinary_action", {
    p_employee_id: input.employeeId,
    p_severity: input.severity,
    p_reason: input.reason,
    p_details: input.details || null,
    p_occurred_on: input.occurredOn,
  });
  if (error) throw error;
}

export interface DashboardStats {
  totalEmployees: number;
  workingNow: number;
  pendingLeave: number;
  attendanceRate: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const today = new Date().toISOString().slice(0, 10);
  const [employees, sessions, pending] = await Promise.all([listEmployees(), listAttendanceSessions(today), listPendingLeaveRequests()]);
  const workingNow = sessions.filter((s) => s.state === "working" || s.state === "on_break" || s.state === "on_lunch").length;
  const attendanceRate = employees.length ? Math.round((sessions.length / employees.length) * 100) : 0;
  return { totalEmployees: employees.length, workingNow, pendingLeave: pending.length, attendanceRate };
}
