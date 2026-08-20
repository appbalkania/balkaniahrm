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
  active: boolean;
  startDate: string | null;
}

export async function listEmployees(): Promise<AdminEmployee[]> {
  const { data, error } = await client()
    .from("profiles")
    .select("id,full_name,employee_code,role,team_id,active,start_date,teams!profiles_team_id_fkey(name)")
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
      active: row.active,
      startDate: row.start_date,
    };
  });
}

export async function setEmployeeActive(employeeId: string, active: boolean): Promise<void> {
  const { data, error } = await client().functions.invoke("set-employee-active", { body: { employeeId, active } });
  if (error) return unwrapFunctionError(error);
  if (data?.error) throw new Error(data.error);
}

export interface CreateEmployeeInput {
  fullName: string;
  email: string;
  role: string;
  teamId?: string | null;
  startDate?: string;
  ppsNumber?: string;
  dateOfBirth?: string;
  phoneNumber?: string;
  address?: string;
  placeOfBirth?: string;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<AdminEmployee> {
  const { data, error } = await client().functions.invoke("create-employee", {
    body: {
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      teamId: input.teamId || null,
      redirectTo: `${window.location.origin}/welcome`,
      startDate: input.startDate || undefined,
      ppsNumber: input.ppsNumber || undefined,
      dateOfBirth: input.dateOfBirth || undefined,
      phoneNumber: input.phoneNumber || undefined,
      address: input.address || undefined,
      placeOfBirth: input.placeOfBirth || undefined,
    },
  });
  if (error) return unwrapFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return {
    id: data.id,
    fullName: data.fullName,
    employeeCode: data.employeeCode,
    role: data.role,
    teamId: data.teamId ?? null,
    teamName: null,
    active: true,
    startDate: data.startDate ?? null,
  };
}

export interface EmployeeDetails {
  ppsNumber: string | null;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  address: string | null;
  placeOfBirth: string | null;
}

export async function getEmployeeDetails(employeeId: string): Promise<EmployeeDetails> {
  const { data, error } = await client()
    .from("employee_details")
    .select("pps_number,date_of_birth,phone_number,address,place_of_birth")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return {
    ppsNumber: data?.pps_number ?? null,
    dateOfBirth: data?.date_of_birth ?? null,
    phoneNumber: data?.phone_number ?? null,
    address: data?.address ?? null,
    placeOfBirth: data?.place_of_birth ?? null,
  };
}

export async function upsertEmployeeDetails(employeeId: string, details: EmployeeDetails): Promise<void> {
  const { error } = await client()
    .from("employee_details")
    .upsert(
      {
        employee_id: employeeId,
        pps_number: details.ppsNumber || null,
        date_of_birth: details.dateOfBirth || null,
        phone_number: details.phoneNumber || null,
        address: details.address || null,
        place_of_birth: details.placeOfBirth || null,
      },
      { onConflict: "employee_id" },
    );
  if (error) throw error;
}

export interface UpdateEmployeeInput {
  id: string;
  fullName: string;
  employeeCode: string;
  role: string;
  teamId?: string | null;
  startDate?: string;
}

export async function updateEmployee(input: UpdateEmployeeInput): Promise<AdminEmployee> {
  const { data, error } = await client()
    .from("profiles")
    .update({
      full_name: input.fullName,
      employee_code: input.employeeCode,
      role: input.role,
      team_id: input.teamId || null,
      ...(input.startDate ? { start_date: input.startDate } : {}),
    })
    .eq("id", input.id)
    .select("id,full_name,employee_code,role,team_id,active,start_date,teams!profiles_team_id_fkey(name)")
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
    active: data.active,
    startDate: data.start_date,
  };
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  const { data, error } = await client().functions.invoke("delete-employee", { body: { employeeId } });
  if (error) return unwrapFunctionError(error);
  if (data?.error) throw new Error(data.error);
}

export async function purgeEmployee(employeeId: string): Promise<void> {
  const { data, error } = await client().functions.invoke("purge-employee", { body: { employeeId } });
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
    .eq("active", true)
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
  employeeId: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  status: string;
  employeeName: string;
}

export async function listPendingLeaveRequests(): Promise<AdminLeaveRequest[]> {
  const { data, error } = await client()
    .from("leave_requests")
    .select("id,employee_id,leave_type,starts_on,ends_on,status,profiles!leave_requests_employee_id_fkey(full_name)")
    .eq("status", "pending")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      employeeId: row.employee_id,
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
  // leave_balances_current is a view that computes "earned" live from monthly
  // accrual and is already scoped to the active Irish leave year (Apr-Mar) —
  // see 20260825_leave_year_accrual.sql. It has no foreign key of its own for
  // PostgREST to embed profiles through, so employee names are joined here.
  const [{ data, error }, employees] = await Promise.all([
    client().from("leave_balances_current").select("id,employee_id,leave_type,entitlement,earned,used").order("leave_type"),
    listEmployees(),
  ]);
  if (error) throw error;
  const nameById = new Map(employees.map((e) => [e.id, e.fullName]));
  return (data ?? []).map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    employeeName: nameById.get(row.employee_id) ?? "Unknown",
    leaveType: row.leave_type,
    entitlement: Number(row.entitlement),
    earned: Number(row.earned),
    used: Number(row.used),
  }));
}

export interface SetLeaveEntitlementInput {
  employeeId: string;
  leaveType: string;
  entitlement: number;
}

export async function setLeaveEntitlement(input: SetLeaveEntitlementInput): Promise<void> {
  // "earned" is no longer a stored column — it's computed live from entitlement
  // by leave_balances_current. Omitting leave_year_start lets its column default
  // (current_leave_year_start()) target this year's row, so this always creates
  // or updates the *current* leave year's entitlement, never a past year's.
  // "used" is deliberately left out so an existing balance's usage isn't reset
  // when HR updates the entitlement mid-year.
  const { error } = await client()
    .from("leave_balances")
    .upsert(
      { employee_id: input.employeeId, leave_type: input.leaveType, entitlement: input.entitlement },
      { onConflict: "employee_id,leave_type,leave_year_start" },
    );
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
  workingDays: number[];
  isDefault: boolean;
}

const SCHEDULE_COLUMNS = "id,name,branch_name,starts_at,ends_at,working_days,is_default";

function mapWorkSchedule(row: {
  id: string;
  name: string;
  branch_name: string | null;
  starts_at: string;
  ends_at: string;
  working_days: number[] | null;
  is_default: boolean;
}): AdminWorkSchedule {
  return {
    id: row.id,
    name: row.name,
    branchName: row.branch_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    workingDays: row.working_days ?? [],
    isDefault: row.is_default,
  };
}

export async function listWorkSchedules(): Promise<AdminWorkSchedule[]> {
  const { data, error } = await client().from("work_schedules").select(SCHEDULE_COLUMNS).order("name");
  if (error) throw error;
  return (data ?? []).map(mapWorkSchedule);
}

export interface CreateWorkScheduleInput {
  name: string;
  branchName?: string | null;
  startsAt: string;
  endsAt: string;
  workingDays: number[];
  isDefault: boolean;
}

export async function createWorkSchedule(input: CreateWorkScheduleInput): Promise<AdminWorkSchedule> {
  // A single default is enforced by a partial unique index, so an existing
  // default must be cleared first rather than relying on insert order.
  if (input.isDefault) await clearDefaultWorkSchedule();
  const { data, error } = await client()
    .from("work_schedules")
    .insert({
      name: input.name,
      branch_name: input.branchName || null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      working_days: input.workingDays,
      is_default: input.isDefault,
    })
    .select(SCHEDULE_COLUMNS)
    .single();
  if (error) throw error;
  return mapWorkSchedule(data);
}

export async function deleteWorkSchedule(id: string): Promise<void> {
  const { error } = await client().from("work_schedules").delete().eq("id", id);
  if (error) throw error;
}

async function clearDefaultWorkSchedule(): Promise<void> {
  const { error } = await client().from("work_schedules").update({ is_default: false }).eq("is_default", true);
  if (error) throw error;
}

export type AssetCategory = "laptop" | "phone" | "vehicle" | "tool" | "uniform" | "other";
export type AssetStatus = "available" | "assigned" | "retired";

export interface AdminAsset {
  id: string;
  assetTag: string;
  name: string;
  category: AssetCategory;
  serialNumber: string | null;
  notes: string | null;
  status: AssetStatus;
  holderId: string | null;
  holderName: string | null;
  assignedOn: string | null;
}

export async function listAssets(): Promise<AdminAsset[]> {
  // The active assignment is fetched separately rather than embedded: PostgREST
  // can't filter an embedded resource down to just the open row, and an asset
  // usually has several historical assignments alongside the current one.
  const [{ data, error }, active, employees] = await Promise.all([
    client().from("assets").select("id,asset_tag,name,category,serial_number,notes,status").order("asset_tag"),
    client().from("asset_assignments").select("asset_id,employee_id,assigned_on").is("returned_on", null),
    listEmployees(),
  ]);
  if (error) throw error;
  if (active.error) throw active.error;

  const nameById = new Map(employees.map((e) => [e.id, e.fullName]));
  const holderByAsset = new Map((active.data ?? []).map((row) => [row.asset_id, row]));

  return (data ?? []).map((row) => {
    const holder = holderByAsset.get(row.id);
    return {
      id: row.id,
      assetTag: row.asset_tag,
      name: row.name,
      category: row.category,
      serialNumber: row.serial_number,
      notes: row.notes,
      status: row.status,
      holderId: holder?.employee_id ?? null,
      holderName: holder ? nameById.get(holder.employee_id) ?? "Unknown" : null,
      assignedOn: holder?.assigned_on ?? null,
    };
  });
}

export interface CreateAssetInput {
  assetTag: string;
  name: string;
  category: AssetCategory;
  serialNumber?: string;
  notes?: string;
}

export async function createAsset(input: CreateAssetInput): Promise<void> {
  const { error } = await client().from("assets").insert({
    asset_tag: input.assetTag.trim(),
    name: input.name.trim(),
    category: input.category,
    serial_number: input.serialNumber?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  if (error) throw error;
}

export async function setAssetRetired(assetId: string, retired: boolean): Promise<void> {
  const { error } = await client()
    .from("assets")
    .update({ status: retired ? "retired" : "available" })
    .eq("id", assetId);
  if (error) throw error;
}

export async function deleteAsset(assetId: string): Promise<void> {
  const { error } = await client().from("assets").delete().eq("id", assetId);
  if (error) throw error;
}

export async function assignAsset(assetId: string, employeeId: string, notes?: string): Promise<void> {
  const { error } = await client().rpc("assign_asset", {
    p_asset_id: assetId,
    p_employee_id: employeeId,
    p_notes: notes?.trim() || null,
  });
  if (error) throw error;
}

export async function returnAsset(assetId: string): Promise<void> {
  const { error } = await client().rpc("return_asset", { p_asset_id: assetId });
  if (error) throw error;
}

export interface AssetAssignmentRecord {
  id: string;
  assetName: string;
  assetTag: string;
  employeeName: string;
  assignedOn: string;
  returnedOn: string | null;
}

export async function listAssetHistory(assetId: string): Promise<AssetAssignmentRecord[]> {
  const [{ data, error }, employees] = await Promise.all([
    client()
      .from("asset_assignments")
      .select("id,employee_id,assigned_on,returned_on,assets!asset_assignments_asset_id_fkey(name,asset_tag)")
      .eq("asset_id", assetId)
      .order("assigned_on", { ascending: false }),
    listEmployees(),
  ]);
  if (error) throw error;
  const nameById = new Map(employees.map((e) => [e.id, e.fullName]));
  return (data ?? []).map((row) => {
    const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
    return {
      id: row.id,
      assetName: asset?.name ?? "Unknown",
      assetTag: asset?.asset_tag ?? "",
      employeeName: nameById.get(row.employee_id) ?? "Unknown",
      assignedOn: row.assigned_on,
      returnedOn: row.returned_on,
    };
  });
}

export interface AdminDevice {
  id: string;
  label: string;
  active: boolean;
  paired: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export async function listAttendanceDevices(): Promise<AdminDevice[]> {
  const { data, error } = await client().from("attendance_devices").select("id,label,active,paired,last_seen_at,created_at").order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, label: row.label, active: row.active, paired: row.paired, lastSeenAt: row.last_seen_at, createdAt: row.created_at }));
}

export interface RegisteredDevice {
  id: string;
  label: string;
  pin: string;
}

export async function registerDevice(label: string): Promise<RegisteredDevice> {
  const { data, error } = await client().rpc("register_attendance_device", { p_label: label });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row.id, label: row.label, pin: row.pin };
}

export async function regenerateDevicePin(deviceId: string): Promise<string> {
  const { data, error } = await client().rpc("regenerate_device_pin", { p_device_id: deviceId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row.pin;
}

export async function setDeviceActive(deviceId: string, active: boolean): Promise<void> {
  const { error } = await client().rpc("set_device_active", { p_device_id: deviceId, p_active: active });
  if (error) throw error;
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

export async function deleteDisciplinaryAction(id: string): Promise<void> {
  const { error } = await client().from("disciplinary_actions").delete().eq("id", id);
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

export interface AdminHoliday {
  id: string;
  date: string;
  name: string;
}

export async function listAdminHolidays(): Promise<AdminHoliday[]> {
  const { data, error } = await client().from("holidays").select("id,holiday_date,name").order("holiday_date");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, date: row.holiday_date, name: row.name }));
}

export async function addHoliday(date: string, name: string): Promise<void> {
  const { error } = await client().from("holidays").insert({ holiday_date: date, name });
  if (error) throw error;
}

export async function deleteHoliday(id: string): Promise<void> {
  const { error } = await client().from("holidays").delete().eq("id", id);
  if (error) throw error;
}

export async function seedBankHolidays(year: number): Promise<void> {
  const { error } = await client().rpc("seed_irish_bank_holidays", { p_year: year });
  if (error) throw error;
}

export interface AdminTimesheetRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  workDate: string;
  state: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  firstBreakStartedAt: string | null;
  firstBreakEndedAt: string | null;
  lunchStartedAt: string | null;
  lunchEndedAt: string | null;
}

export async function listTimesheet(startDate: string, endDate: string): Promise<AdminTimesheetRow[]> {
  const { data, error } = await client()
    .from("attendance_sessions")
    .select(
      "employee_id,work_date,state,clocked_in_at,clocked_out_at,first_break_started_at,first_break_ended_at,lunch_started_at,lunch_ended_at,profiles!attendance_sessions_employee_id_fkey(full_name,employee_code)",
    )
    .gte("work_date", startDate)
    .lte("work_date", endDate)
    .order("work_date");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      employeeId: row.employee_id,
      employeeName: profile?.full_name ?? "Unknown",
      employeeCode: profile?.employee_code ?? "",
      workDate: row.work_date,
      state: row.state,
      clockedInAt: row.clocked_in_at,
      clockedOutAt: row.clocked_out_at,
      firstBreakStartedAt: row.first_break_started_at,
      firstBreakEndedAt: row.first_break_ended_at,
      lunchStartedAt: row.lunch_started_at,
      lunchEndedAt: row.lunch_ended_at,
    };
  });
}
