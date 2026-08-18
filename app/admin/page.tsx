"use client";

import { useEffect, useState } from "react";
import "./admin.css";
import { Icon } from "../../components/icons";
import { getCurrentSession, onAuthStateChange, signInWithPassword, signOut, supabaseConfigured } from "../../lib/auth-service";
import { getMyProfile } from "../../lib/employee-service";
import { recordAttendance } from "../../lib/attendance-service";
import { downloadCsv } from "../../lib/csv";
import type { AttendanceEventType, Profile } from "../../lib/domain";
import {
  addHoliday,
  createEmployee,
  createTeam,
  deleteEmployee,
  deleteHoliday,
  getDashboardStats,
  issueDisciplinaryAction,
  listAdminHolidays,
  listAttendanceDevices,
  listAttendanceSessions,
  listDisciplinaryActions,
  listEmployees,
  listLeaveBalances,
  listManagers,
  listPendingLeaveRequests,
  listTeams,
  listTimesheet,
  listWorkSchedules,
  regenerateDevicePin,
  registerDevice,
  reviewLeaveRequest,
  seedBankHolidays,
  setDeviceActive,
  setLeaveEntitlement,
  updateEmployee,
  updateTeam,
  type AdminAttendanceSession,
  type AdminDevice,
  type AdminDisciplinaryAction,
  type AdminEmployee,
  type AdminHoliday,
  type AdminLeaveBalance,
  type AdminLeaveRequest,
  type AdminManagerOption,
  type AdminTeam,
  type AdminTimesheetRow,
  type AdminWorkSchedule,
  type DashboardStats,
  type DisciplinarySeverity,
  type RegisteredDevice,
} from "../../lib/admin-service";

type Module =
  | "dashboard"
  | "organization"
  | "employees"
  | "teams"
  | "documents"
  | "training"
  | "recruitment"
  | "leaves"
  | "holidays"
  | "disciplinary"
  | "performance"
  | "payroll"
  | "attendance"
  | "timesheets"
  | "schedules"
  | "devices"
  | "assets"
  | "settings"
  | "integrations";
type AuthStatus = "loading" | "signedOut" | "forbidden" | "signedIn";

type ModuleEntry = [Module, string, Parameters<typeof Icon>[0]["name"]];

const moduleGroups: Array<{ label: string; items: ModuleEntry[] }> = [
  { label: "MAIN", items: [["dashboard", "Dashboard", "layout"]] },
  {
    label: "COMPANY",
    items: [
      ["organization", "Organization", "building"],
      ["employees", "Staff Directory", "user"],
      ["teams", "Teams", "users"],
      ["documents", "Documents", "archive"],
      ["training", "Training & Certifications", "graduationCap"],
    ],
  },
  {
    label: "EMPLOYEES",
    items: [
      ["recruitment", "Recruitment", "userPlus"],
      ["leaves", "Leave management", "calendar"],
      ["holidays", "Bank holidays", "calendar"],
      ["disciplinary", "Disciplinary", "warning"],
      ["performance", "Performance Review", "chart"],
      ["payroll", "Payroll", "creditCard"],
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      ["attendance", "Attendance", "clock"],
      ["timesheets", "Timesheets", "chart"],
      ["schedules", "Work schedules", "swap"],
      ["devices", "Kiosk devices", "device"],
      ["assets", "Asset Management", "briefcase"],
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      ["settings", "Settings", "settings"],
      ["integrations", "Integrations", "swap"],
    ],
  },
];

const modules: ModuleEntry[] = moduleGroups.flatMap((group) => group.items);

export default function AdminPage() {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const configured = supabaseConfigured();

  useEffect(() => {
    if (!configured) {
      setStatus("signedOut");
      return;
    }
    let active = true;

    async function evaluate(hasSession: boolean) {
      if (!hasSession) {
        setProfile(null);
        setStatus("signedOut");
        return;
      }
      try {
        const p = await getMyProfile();
        if (!active) return;
        if (p && (p.role === "manager" || p.role === "hr_admin")) {
          setProfile(p);
          setStatus("signedIn");
        } else {
          setStatus("forbidden");
        }
      } catch {
        if (active) setStatus("forbidden");
      }
    }

    getCurrentSession().then((session) => {
      if (active) void evaluate(!!session);
    });
    const unsubscribe = onAuthStateChange((session) => void evaluate(!!session));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured]);

  if (status === "loading") {
    return (
      <main className="admin-auth-screen">
        <Icon name="spinner" size={24} className="spin" />
      </main>
    );
  }

  if (status === "forbidden") {
    return (
      <main className="admin-auth-screen">
        <Icon name="warning" size={36} className="warn-icon" />
        <h1>Access restricted</h1>
        <p className="muted">This portal is limited to managers and HR administrators.</p>
        <button className="outline-button" onClick={() => signOut()}>Sign out</button>
      </main>
    );
  }

  if (status !== "signedIn" || !profile) {
    return <AdminLogin configured={configured} />;
  }

  return <AdminShell profile={profile} />;
}

function AdminLogin({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-auth-screen">
      <div className="admin-brand"><img src="/icon.png" alt="" /><b>Balkania</b></div>
      <h1>Admin sign-in</h1>
      <p className="muted">Restricted to managers and HR administrators.</p>
      {!configured && (
        <p className="admin-notice warn">
          <Icon name="warning" size={15} /> Supabase environment variables are not set for this deployment.
        </p>
      )}
      <form className="admin-login-form" onSubmit={handleSubmit}>
        <label>
          Work email
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!configured} />
        </label>
        <label>
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!configured} />
        </label>
        {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
        <button className="primary-admin" type="submit" disabled={loading || !configured}>{loading ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}

const MANAGER_MODULES: Module[] = ["attendance", "timesheets", "leaves", "disciplinary"];

function AdminShell({ profile }: { profile: Profile }) {
  const isManager = profile.role === "manager";
  const visibleGroups = moduleGroups
    .map((group) => ({
      label: group.label,
      items: isManager ? group.items.filter(([id]) => MANAGER_MODULES.includes(id)) : group.items,
    }))
    .filter((group) => group.items.length > 0);
  const [module, setModule] = useState<Module>(visibleGroups[0].items[0][0]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(id);
  }, [notice]);

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><img src="/icon.png" alt="" /><b>Balkania</b></div>
        {visibleGroups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map(([id, label, icon]) => (
              <button key={id} className={module === id ? "active" : ""} onClick={() => setModule(id)}>
                <Icon name={icon} size={17} />
                {label}
              </button>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <span>Signed in as {profile.fullName}</span>
          <a className="sidebar-signout" href="/?view=employee">
            <Icon name="qr" size={15} /> Check-in view
          </a>
          <button className="sidebar-signout" onClick={() => signOut()}>
            <Icon name="logout" size={15} /> Sign out
          </button>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-header">
          <div>
            <p className="eyebrow">BALKANIA ADMIN</p>
            <h1>{modules.find(([id]) => id === module)?.[1]}</h1>
          </div>
          <div className="admin-actions">
            <button className="avatar">{initials(profile.fullName)}</button>
          </div>
        </header>
        {notice && <p className="admin-notice">{notice}</p>}
        {module === "dashboard" && <Dashboard onNavigate={setModule} />}
        {module === "organization" && (
          <EmptyPanel icon="building" title="Organization" note="Company structure, branches, and departments will live here." />
        )}
        {module === "employees" && <Employees setNotice={setNotice} />}
        {module === "teams" && <Teams setNotice={setNotice} />}
        {module === "documents" && (
          <EmptyPanel icon="archive" title="Documents" note="Employee and company document storage is coming in a later release." />
        )}
        {module === "training" && (
          <EmptyPanel icon="graduationCap" title="Training & Certifications" note="Course tracking and certification renewals are coming in a later release." />
        )}
        {module === "recruitment" && (
          <EmptyPanel icon="userPlus" title="Recruitment" note="Job postings and candidate pipelines are coming in a later release." />
        )}
        {module === "attendance" && <Attendance setNotice={setNotice} isHrAdmin={profile.role === "hr_admin"} />}
        {module === "timesheets" && <Timesheets setNotice={setNotice} />}
        {module === "leaves" && <Leaves setNotice={setNotice} />}
        {module === "holidays" && <Holidays setNotice={setNotice} />}
        {module === "disciplinary" && <Disciplinary setNotice={setNotice} />}
        {module === "performance" && (
          <EmptyPanel icon="chart" title="Performance Review" note="Goals, reviews, and feedback cycles are coming in a later release." />
        )}
        {module === "payroll" && (
          <EmptyPanel icon="creditCard" title="Payroll" note="Payroll runs and payslips are coming in a later release." />
        )}
        {module === "schedules" && <Schedules setNotice={setNotice} />}
        {module === "devices" && <Devices setNotice={setNotice} />}
        {module === "assets" && (
          <EmptyPanel icon="briefcase" title="Asset Management" note="Equipment and asset assignments are coming in a later release." />
        )}
        {module === "settings" && <Settings setNotice={setNotice} />}
        {module === "integrations" && (
          <EmptyPanel icon="swap" title="Integrations" note="Connect third-party tools once this module is built." />
        )}
      </section>
    </main>
  );
}

type NoticeProps = { setNotice: (value: string) => void };

function Dashboard({ onNavigate }: { onNavigate: (module: Module) => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getDashboardStats()
      .then((s) => active && setStats(s))
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load dashboard data."));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!stats) return <LoadingPanel />;

  return (
    <>
      <div className="admin-stats">
        <Stat label="Active employees" value={String(stats.totalEmployees)} note="All roles" />
        <Stat label="Working now" value={String(stats.workingNow)} note="Live sessions" />
        <Stat label="Leave requests" value={String(stats.pendingLeave)} note="Awaiting review" />
        <Stat label="Attendance rate" value={`${stats.attendanceRate}%`} note="Today" />
      </div>
      <div className="admin-grid">
        <section className="panel wide">
          <div className="panel-title">
            <h2>Today&apos;s attendance</h2>
            <button onClick={() => onNavigate("attendance")}>View report <Icon name="chevronRight" size={14} /></button>
          </div>
          <p className="muted small">Open the attendance module for live clock-in status per employee.</p>
        </section>
        <section className="panel">
          <div className="panel-title"><h2>Quick actions</h2></div>
          <button className="quick" onClick={() => onNavigate("employees")}><Icon name="plus" size={15} /> Add employee</button>
          <button className="quick" onClick={() => onNavigate("leaves")}><Icon name="check" size={15} /> Review leave</button>
          <button className="quick" onClick={() => onNavigate("devices")}><Icon name="device" size={15} /> Manage kiosk</button>
        </section>
        <section className="panel">
          <div className="panel-title"><h2>Expiring items</h2></div>
          <p className="muted">No contracts or documents require attention.</p>
        </section>
      </div>
    </>
  );
}

function Employees({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminEmployee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<AdminEmployee | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  function load() {
    listEmployees()
      .then((data) => setRows(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load employees."));
  }

  useEffect(() => {
    load();
  }, []);

  function handleExport() {
    if (!rows || rows.length === 0) {
      setNotice("No employees to export yet.");
      return;
    }
    setExporting(true);
    try {
      downloadCsv(
        `employees-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Full name", "Employee code", "Role", "Team"],
        rows.map((row) => [row.fullName, row.employeeCode, row.role, row.teamName ?? ""]),
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(row: AdminEmployee) {
    if (!window.confirm(`Delete ${row.fullName}? This permanently removes their account and cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await deleteEmployee(row.id);
      setNotice(`${row.fullName} was deleted.`);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't delete the employee.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Toolbar action="Add employee" onAction={() => setShowAddModal(true)} onExport={handleExport} exporting={exporting} />
      {showAddModal && (
        <AddEmployeeModal
          onClose={() => setShowAddModal(false)}
          onCreated={(employee) => {
            setShowAddModal(false);
            load();
            setNotice(`Invited ${employee.fullName}. They'll receive an email to set their password.`);
          }}
        />
      )}
      {editingEmployee && (
        <EditEmployeeModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSaved={(employee) => {
            setEditingEmployee(null);
            load();
            setNotice(`${employee.fullName} was updated.`);
          }}
        />
      )}
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <EmptyPanel icon="users" title="No employees yet" note="Add or import employees to see them here." />
      ) : (
        <section className="panel">
          <div className="table-head cols-5"><b>Employee</b><b>Code</b><b>Role</b><b>Team</b><b>Actions</b></div>
          {rows.map((row) => (
            <div className="table-row cols-5" key={row.id}>
              <span><i className="person-dot">{row.fullName[0]}</i>{row.fullName}</span>
              <span>{row.employeeCode}</span>
              <span className="capitalize">{row.role.replace("_", " ")}</span>
              <span>{row.teamName ?? "—"}</span>
              <span className="row-actions">
                <button className="icon-action" disabled={busyId === row.id} onClick={() => setEditingEmployee(row)} aria-label={`Edit ${row.fullName}`}>
                  <Icon name="edit" size={15} />
                </button>
                <button className="icon-action reject" disabled={busyId === row.id} onClick={() => handleDelete(row)} aria-label={`Delete ${row.fullName}`}>
                  <Icon name="trash" size={15} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function AddEmployeeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (employee: AdminEmployee) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [role, setRole] = useState("employee");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTeams()
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  const teamRequired = role !== "kiosk";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (teamRequired && !teamId) {
      setError("Choose a team.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const employee = await createEmployee({ fullName, email, employeeCode, role, teamId: teamId || null });
      onCreated(employee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Add employee</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="muted small">Creates a profile and sends a Supabase auth invite email so they can set their password.</p>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Full name
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={saving} />
          </label>
          <label>
            Work email
            <input type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
          </label>
          <label>
            Employee code
            <input required value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} disabled={saving} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)} disabled={saving}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="hr_admin">HR admin</option>
              <option value="kiosk">Kiosk</option>
            </select>
          </label>
          {teamRequired && (
            <label>
              Team
              <select required value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={saving}>
                <option value="">Select a team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Sending invite…" : "Send invite"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditEmployeeModal({
  employee,
  onClose,
  onSaved,
}: {
  employee: AdminEmployee;
  onClose: () => void;
  onSaved: (employee: AdminEmployee) => void;
}) {
  const [fullName, setFullName] = useState(employee.fullName);
  const [employeeCode, setEmployeeCode] = useState(employee.employeeCode);
  const [role, setRole] = useState(employee.role);
  const [teamId, setTeamId] = useState(employee.teamId ?? "");
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTeams()
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await updateEmployee({ id: employee.id, fullName, employeeCode, role, teamId: teamId || null });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Edit employee</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Full name
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={saving} />
          </label>
          <label>
            Employee code
            <input required value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} disabled={saving} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)} disabled={saving}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="hr_admin">HR admin</option>
              <option value="kiosk">Kiosk</option>
            </select>
          </label>
          <label>
            Team
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={saving}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Teams({ setNotice }: NoticeProps) {
  const [teams, setTeams] = useState<AdminTeam[] | null>(null);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<AdminTeam | null>(null);

  function load() {
    Promise.all([listTeams(), listEmployees()])
      .then(([teamRows, employeeRows]) => {
        setTeams(teamRows);
        setEmployees(employeeRows);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load teams."));
  }

  useEffect(() => {
    load();
  }, []);

  const memberCounts = employees.reduce<Record<string, number>>((acc, e) => {
    if (e.teamId) acc[e.teamId] = (acc[e.teamId] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Toolbar action="Create team" onAction={() => setShowModal(true)} />
      {showModal && (
        <CreateTeamModal
          onClose={() => setShowModal(false)}
          onCreated={(team) => {
            setShowModal(false);
            setNotice(`Team "${team.name}" created.`);
            load();
          }}
        />
      )}
      {editingTeam && (
        <EditTeamModal
          team={editingTeam}
          onClose={() => setEditingTeam(null)}
          onSaved={(team) => {
            setEditingTeam(null);
            setNotice(`Team "${team.name}" was updated.`);
            load();
          }}
        />
      )}
      {error ? (
        <ErrorState message={error} />
      ) : !teams ? (
        <LoadingPanel />
      ) : teams.length === 0 ? (
        <EmptyPanel icon="users" title="No teams yet" note="Create a team and assign a manager so employees can be added to it." />
      ) : (
        <section className="panel">
          <div className="table-head cols-5"><b>Team</b><b>Manager</b><b>Members</b><b>Status</b><b>Actions</b></div>
          {teams.map((team) => (
            <div className="table-row cols-5" key={team.id}>
              <span>{team.name}</span>
              <span>{team.managerName ?? "Unassigned"}</span>
              <span>{memberCounts[team.id] ?? 0}</span>
              <span className={`pill ${team.managerId ? "success" : "pending"}`}>{team.managerId ? "Managed" : "No manager"}</span>
              <span className="row-actions">
                <button className="icon-action" onClick={() => setEditingTeam(team)} aria-label={`Edit ${team.name}`}>
                  <Icon name="edit" size={15} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function CreateTeamModal({ onClose, onCreated }: { onClose: () => void; onCreated: (team: AdminTeam) => void }) {
  const [name, setName] = useState("");
  const [managerId, setManagerId] = useState("");
  const [managers, setManagers] = useState<AdminManagerOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listManagers()
      .then(setManagers)
      .catch(() => setManagers([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const team = await createTeam({ name, managerId: managerId || null });
      onCreated(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the team.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Create team</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="muted small">Employees assigned to this team are managed by whoever you pick here.</p>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Team name
            <input required value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </label>
          <label>
            Manager
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={saving}>
              <option value="">Assign later</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName}</option>
              ))}
            </select>
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Creating…" : "Create team"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditTeamModal({
  team,
  onClose,
  onSaved,
}: {
  team: AdminTeam;
  onClose: () => void;
  onSaved: (team: AdminTeam) => void;
}) {
  const [name, setName] = useState(team.name);
  const [managerId, setManagerId] = useState(team.managerId ?? "");
  const [managers, setManagers] = useState<AdminManagerOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listManagers()
      .then(setManagers)
      .catch(() => setManagers([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await updateTeam({ id: team.id, name, managerId: managerId || null });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Edit team</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Team name
            <input required value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </label>
          <label>
            Manager
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={saving}>
              <option value="">Unassigned</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName}</option>
              ))}
            </select>
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Attendance({ setNotice, isHrAdmin }: NoticeProps & { isHrAdmin: boolean }) {
  const [rows, setRows] = useState<AdminAttendanceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  function load() {
    listAttendanceSessions(today)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load attendance."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  const working = rows?.filter((r) => r.state === "working" || r.state === "on_break" || r.state === "on_lunch").length ?? 0;
  const complete = rows?.filter((r) => r.state === "complete").length ?? 0;

  function handleExport() {
    if (!rows || rows.length === 0) {
      setNotice("No attendance records to export yet.");
      return;
    }
    setExporting(true);
    try {
      downloadCsv(
        `attendance-${today}.csv`,
        ["Employee", "Employee code", "Clock in", "Clock out", "Status"],
        rows.map((row) => [row.employeeName, row.employeeCode, row.clockedInAt ?? "", row.clockedOutAt ?? "", row.state]),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Toolbar
        action={isHrAdmin ? "Record attendance" : "Review exceptions"}
        onAction={() =>
          isHrAdmin
            ? setShowRecordModal(true)
            : setNotice("Attendance exceptions are drawn from attendance_sessions and attendance_events.")
        }
        onExport={handleExport}
        exporting={exporting}
      />
      {showRecordModal && (
        <RecordAttendanceModal
          onClose={() => setShowRecordModal(false)}
          onRecorded={(employeeName) => {
            setShowRecordModal(false);
            setNotice(`Attendance recorded for ${employeeName}.`);
            load();
          }}
        />
      )}
      <div className="admin-stats">
        <Stat label="Currently working" value={String(working)} note="Live sessions" />
        <Stat label="Work completed" value={String(complete)} note="Today" />
        <Stat label="Total sessions" value={String(rows?.length ?? 0)} note="Today" />
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <EmptyPanel icon="clock" title="No attendance yet today" note="Records will appear as employees clock in." />
      ) : (
        <section className="panel">
          <div className="panel-title"><h2>Attendance records</h2><span className="filter">Today</span></div>
          <div className="table-head"><b>Employee</b><b>Clock in</b><b>Clock out</b><b>Status</b></div>
          {rows.map((row) => (
            <div className="table-row" key={row.id}>
              <span>{row.employeeName}</span>
              <span>{row.clockedInAt ? formatTime(row.clockedInAt) : "--:--"}</span>
              <span>{row.clockedOutAt ? formatTime(row.clockedOutAt) : "--:--"}</span>
              <span className={`pill ${row.state === "complete" ? "success" : row.state === "not_started" ? "" : "pending"}`}>{stateLabel(row.state)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

const attendanceEventOptions: Array<[AttendanceEventType, string]> = [
  ["clock_in", "🟢 Clock in"],
  ["clock_out", "🔴 Clock out"],
  ["break_start", "☕ First break start"],
  ["break_end", "▶️ First break end"],
  ["lunch_start", "🍽️ Lunch start"],
  ["lunch_end", "▶️ Lunch end"],
];

function RecordAttendanceModal({ onClose, onRecorded }: { onClose: () => void; onRecorded: (employeeName: string) => void }) {
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [eventType, setEventType] = useState<AttendanceEventType>("clock_in");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listEmployees()
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId) {
      setError("Choose an employee.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await recordAttendance({ eventType, idempotencyKey: crypto.randomUUID(), source: "admin", employeeId });
      const employee = employees.find((e) => e.id === employeeId);
      onRecorded(employee?.fullName ?? "employee");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record attendance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Record attendance</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="muted small">Records the event for today, exactly as if the employee had done it themselves.</p>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Employee
            <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={saving}>
              <option value="">Select an employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.fullName}</option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select value={eventType} onChange={(e) => setEventType(e.target.value as AttendanceEventType)} disabled={saving}>
              {attendanceEventOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Recording…" : "Record"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function hoursWorked(row: AdminTimesheetRow): number {
  if (!row.clockedInAt) return 0;
  const end = row.clockedOutAt ? new Date(row.clockedOutAt) : new Date();
  let ms = end.getTime() - new Date(row.clockedInAt).getTime();
  if (row.firstBreakStartedAt && row.firstBreakEndedAt) ms -= new Date(row.firstBreakEndedAt).getTime() - new Date(row.firstBreakStartedAt).getTime();
  if (row.lunchStartedAt && row.lunchEndedAt) ms -= new Date(row.lunchEndedAt).getTime() - new Date(row.lunchStartedAt).getTime();
  return Math.max(0, ms / 3600000);
}

interface EmployeeTimesheetSummary {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  days: number;
  hours: number;
}

function Timesheets({ setNotice }: NoticeProps) {
  const now = new Date();
  const [startDate, setStartDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => now.toISOString().slice(0, 10));
  const [rows, setRows] = useState<AdminTimesheetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  function load() {
    setRows(null);
    listTimesheet(startDate, endDate)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the timesheet."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const summaries: EmployeeTimesheetSummary[] = [];
  if (rows) {
    const byEmployee = new Map<string, EmployeeTimesheetSummary>();
    for (const row of rows) {
      const existing = byEmployee.get(row.employeeId);
      const hours = hoursWorked(row);
      if (existing) {
        existing.days += 1;
        existing.hours += hours;
      } else {
        byEmployee.set(row.employeeId, { employeeId: row.employeeId, employeeName: row.employeeName, employeeCode: row.employeeCode, days: 1, hours });
      }
    }
    summaries.push(...Array.from(byEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName)));
  }
  const totalHours = summaries.reduce((sum, s) => sum + s.hours, 0);

  function handleExport() {
    if (!rows || rows.length === 0) {
      setNotice("No timesheet records to export for this range.");
      return;
    }
    setExporting(true);
    try {
      downloadCsv(
        `timesheet-${startDate}-to-${endDate}.csv`,
        ["Employee", "Employee code", "Date", "Clock in", "Clock out", "Hours"],
        rows.map((row) => [row.employeeName, row.employeeCode, row.workDate, row.clockedInAt ?? "", row.clockedOutAt ?? "", hoursWorked(row).toFixed(2)]),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <button className="outline-button" onClick={handleExport} disabled={exporting}>
          <Icon name="download" size={15} /> {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      <div className="timesheet-range">
        <label>
          From
          <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <div className="admin-stats">
        <Stat label="Employees" value={String(summaries.length)} note="In range" />
        <Stat label="Total hours" value={totalHours.toFixed(1)} note="All employees" />
        <Stat label="Avg. hours" value={summaries.length ? (totalHours / summaries.length).toFixed(1) : "0"} note="Per employee" />
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : summaries.length === 0 ? (
        <EmptyPanel icon="chart" title="No attendance in this range" note="Adjust the date range to see recorded hours." />
      ) : (
        <section className="panel">
          <div className="panel-title"><h2>Timesheet overview</h2><span className="filter">{formatDate(startDate)} – {formatDate(endDate)}</span></div>
          <div className="table-head"><b>Employee</b><b>Employee code</b><b>Days worked</b><b>Total hours</b></div>
          {summaries.map((summary) => (
            <div className="table-row" key={summary.employeeId}>
              <span>{summary.employeeName}</span>
              <span>{summary.employeeCode}</span>
              <span>{summary.days}</span>
              <span>{summary.hours.toFixed(1)}h</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Leaves({ setNotice }: NoticeProps) {
  const [view, setView] = useState<"requests" | "entitlements">("requests");

  return (
    <>
      <div className="module-tabs">
        <button className={view === "requests" ? "active" : ""} onClick={() => setView("requests")}>Requests</button>
        <button className={view === "entitlements" ? "active" : ""} onClick={() => setView("entitlements")}>Entitlements</button>
      </div>
      {view === "requests" ? <LeaveRequests setNotice={setNotice} /> : <LeaveEntitlements setNotice={setNotice} />}
    </>
  );
}

function LeaveRequests({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminLeaveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await listPendingLeaveRequests();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load leave requests.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    try {
      await reviewLeaveRequest(id, status);
      setNotice(`Leave request ${status}.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't update the request.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="admin-stats">
        <Stat label="Pending requests" value={String(rows?.length ?? 0)} note="Needs a decision" />
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <EmptyPanel icon="calendar" title="No pending leave requests" note="New requests will appear here for review." />
      ) : (
        <section className="panel">
          <div className="table-head"><b>Employee</b><b>Leave type</b><b>Dates</b><b>Actions</b></div>
          {rows.map((row) => (
            <div className="table-row" key={row.id}>
              <span>{row.employeeName}</span>
              <span className="capitalize">{row.leaveType}</span>
              <span>{formatDate(row.startsOn)} – {formatDate(row.endsOn)}</span>
              <span className="row-actions">
                <button className="icon-action approve" disabled={busyId === row.id} onClick={() => decide(row.id, "approved")} aria-label="Approve">
                  <Icon name="check" size={15} />
                </button>
                <button className="icon-action reject" disabled={busyId === row.id} onClick={() => decide(row.id, "rejected")} aria-label="Reject">
                  <Icon name="x" size={15} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

const leaveTypeOptions: Array<[string, string]> = [
  ["annual", "Annual"],
  ["medical", "Medical"],
  ["unpaid", "Unpaid"],
  ["other", "Other"],
];

function LeaveEntitlements({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminLeaveBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  function load() {
    listLeaveBalances()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load leave entitlements."));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <Toolbar action="Set entitlement" onAction={() => setShowModal(true)} />
      {showModal && (
        <SetEntitlementModal
          onClose={() => setShowModal(false)}
          onSaved={(employeeName) => {
            setShowModal(false);
            setNotice(`Entitlement saved for ${employeeName}.`);
            load();
          }}
        />
      )}
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <EmptyPanel icon="calendar" title="No entitlements set" note="Set entitlements for employees and managers so their leave balances show up correctly." />
      ) : (
        <section className="panel">
          <div className="table-head cols-5"><b>Employee</b><b>Leave type</b><b>Entitlement</b><b>Earned</b><b>Used</b></div>
          {rows.map((row) => (
            <div className="table-row cols-5" key={row.id}>
              <span>{row.employeeName}</span>
              <span className="capitalize">{row.leaveType}</span>
              <span>{row.entitlement}</span>
              <span>{row.earned}</span>
              <span>{row.used}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function SetEntitlementModal({ onClose, onSaved }: { onClose: () => void; onSaved: (employeeName: string) => void }) {
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("annual");
  const [entitlement, setEntitlement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listEmployees()
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId) {
      setError("Choose an employee.");
      return;
    }
    const value = Number(entitlement);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a valid number of days.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await setLeaveEntitlement({ employeeId, leaveType, entitlement: value });
      const employee = employees.find((e) => e.id === employeeId);
      onSaved(employee?.fullName ?? "employee");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the entitlement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Set entitlement</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="muted small">Works for employees and managers alike. Setting an existing employee/leave type combination updates it.</p>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Employee or manager
            <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={saving}>
              <option value="">Select a person</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.fullName}</option>
              ))}
            </select>
          </label>
          <label>
            Leave type
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} disabled={saving}>
              {leaveTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Entitlement (days)
            <input type="number" min="0" step="0.5" required value={entitlement} onChange={(e) => setEntitlement(e.target.value)} disabled={saving} />
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const severityLabels: Record<DisciplinarySeverity, string> = {
  verbal_warning: "Verbal warning",
  written_warning: "Written warning",
  final_warning: "Final warning",
  suspension: "Suspension",
  termination_notice: "Termination notice",
};

const severityPillClass: Record<DisciplinarySeverity, string> = {
  verbal_warning: "",
  written_warning: "pending",
  final_warning: "danger",
  suspension: "danger",
  termination_notice: "danger",
};

function Disciplinary({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminDisciplinaryAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  function load() {
    listDisciplinaryActions()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load disciplinary actions."));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <Toolbar action="Issue action" onAction={() => setShowModal(true)} />
      {showModal && (
        <IssueDisciplinaryModal
          onClose={() => setShowModal(false)}
          onIssued={() => {
            setShowModal(false);
            setNotice("Disciplinary action recorded.");
            load();
          }}
        />
      )}
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <EmptyPanel icon="warning" title="No disciplinary actions" note="Actions you issue to employees will appear here." />
      ) : (
        <section className="panel">
          <div className="table-head"><b>Employee</b><b>Severity</b><b>Reason</b><b>Date</b></div>
          {rows.map((row) => (
            <div className="table-row" key={row.id}>
              <span><i className="person-dot">{row.employeeName[0]}</i>{row.employeeName}</span>
              <span><span className={`pill ${severityPillClass[row.severity]}`}>{severityLabels[row.severity]}</span></span>
              <span>{row.reason}</span>
              <span>{formatDate(row.occurredOn)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function IssueDisciplinaryModal({ onClose, onIssued }: { onClose: () => void; onIssued: () => void }) {
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [severity, setSeverity] = useState<DisciplinarySeverity>("verbal_warning");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listEmployees()
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId) {
      setError("Choose an employee.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await issueDisciplinaryAction({ employeeId, severity, reason, details, occurredOn });
      onIssued();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record the action.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Issue disciplinary action</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="muted small">Only visible to HR and the employee's manager.</p>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Employee
            <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={saving}>
              <option value="">Select an employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.fullName}</option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value as DisciplinarySeverity)} disabled={saving}>
              {Object.entries(severityLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} disabled={saving} />
          </label>
          <label>
            Reason
            <input required value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} placeholder="e.g. Repeated late arrival" />
          </label>
          <label>
            Details (optional)
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={saving} rows={3} />
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Saving…" : "Issue action"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Holidays({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminHoliday[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  function load() {
    listAdminHolidays()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load holidays."));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSeedNextYear() {
    setSeeding(true);
    try {
      const nextYear = new Date().getFullYear() + 1;
      await seedBankHolidays(nextYear);
      setNotice(`${nextYear} bank holidays seeded.`);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't seed next year's holidays.");
    } finally {
      setSeeding(false);
    }
  }

  async function handleDelete(holiday: AdminHoliday) {
    setBusyId(holiday.id);
    try {
      await deleteHoliday(holiday.id);
      setNotice(`${holiday.name} removed.`);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't remove the holiday.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="toolbar">
        <button className="outline-button" onClick={handleSeedNextYear} disabled={seeding}>
          <Icon name="calendar" size={15} /> {seeding ? "Seeding…" : `Seed ${new Date().getFullYear() + 1}`}
        </button>
        <button className="primary-admin" onClick={() => setShowModal(true)}><Icon name="plus" size={15} /> Add holiday</button>
      </div>
      {showModal && (
        <AddHolidayModal
          onClose={() => setShowModal(false)}
          onAdded={() => {
            setShowModal(false);
            setNotice("Holiday added.");
            load();
          }}
        />
      )}
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <EmptyPanel icon="calendar" title="No holidays yet" note="Add a holiday, or seed the standard Irish bank holiday calendar." />
      ) : (
        <section className="panel">
          <div className="table-head"><b>Date</b><b>Name</b><b></b><b></b></div>
          {rows.map((row) => (
            <div className="table-row" key={row.id}>
              <span className={row.date < today ? "muted" : undefined}>{formatDate(row.date)}</span>
              <span>{row.name}</span>
              <span />
              <span className="row-actions">
                <button className="outline-button" disabled={busyId === row.id} onClick={() => handleDelete(row)}>
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function AddHolidayModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await addHoliday(date, name);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the holiday.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Add holiday</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Date
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={saving} />
          </label>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="e.g. Company closure day" />
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Adding…" : "Add holiday"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Schedules({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminWorkSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listWorkSchedules()
      .then((data) => active && setRows(data))
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load schedules."));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Toolbar action="Create shift" onAction={() => setNotice("Shift templates connect directly to the work_schedules table.")} />
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <EmptyPanel icon="swap" title="No schedules configured" note="Create a working-hour template to assign to employees." />
      ) : (
        <section className="panel">
          <div className="panel-title"><h2>Working templates</h2></div>
          {rows.map((row) => (
            <div className="schedule-row" key={row.id}>
              <b>{row.name}</b>
              <span>{row.branchName ?? "All branches"} · {row.startsAt.slice(0, 5)}–{row.endsAt.slice(0, 5)}</span>
              <span className={`pill ${row.isDefault ? "success" : ""}`}>{row.isDefault ? "Default" : "Active"}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Devices({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [pinReveal, setPinReveal] = useState<{ label: string; pin: string } | null>(null);

  function load() {
    listAttendanceDevices()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load kiosk devices."));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRegenerate(device: AdminDevice) {
    setBusyId(device.id);
    try {
      const pin = await regenerateDevicePin(device.id);
      setPinReveal({ label: device.label, pin });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't regenerate the PIN.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(device: AdminDevice) {
    setBusyId(device.id);
    try {
      await setDeviceActive(device.id, !device.active);
      setNotice(`${device.label} ${device.active ? "deactivated" : "reactivated"}.`);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't update the device.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Toolbar action="Register kiosk" onAction={() => setShowRegisterModal(true)} />
      {showRegisterModal && (
        <RegisterKioskModal
          onClose={() => setShowRegisterModal(false)}
          onRegistered={(device) => {
            setShowRegisterModal(false);
            setPinReveal({ label: device.label, pin: device.pin });
            load();
          }}
        />
      )}
      {pinReveal && <KioskPinModal label={pinReveal.label} pin={pinReveal.pin} onClose={() => setPinReveal(null)} />}
      <section className="panel">
        <div className="panel-title"><h2>QR attendance devices</h2><span className="pill success">QR mode enabled</span></div>
        <p className="muted">Employees show their rotating personal QR code. A dedicated tablet scans it and records the server-validated attendance event.</p>
        {error ? (
          <ErrorState message={error} />
        ) : !rows ? (
          <LoadingPanel />
        ) : rows.length === 0 ? (
          <p className="muted small">No kiosk devices registered yet.</p>
        ) : (
          rows.map((device) => (
            <div className="device-card" key={device.id}>
              <div>
                <b>{device.label}</b>
                <p className="muted">
                  {device.active ? "Active" : "Inactive"} · Restricted kiosk account
                  {device.lastSeenAt && <> · Last active {new Date(device.lastSeenAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
                </p>
              </div>
              <span className={`pill ${device.paired ? "success" : ""}`}>{device.paired ? "Paired" : "Not paired"}</span>
              <span className="row-actions">
                <button className="outline-button" disabled={busyId === device.id} onClick={() => handleRegenerate(device)}>
                  Regenerate PIN
                </button>
                <button className="outline-button" disabled={busyId === device.id} onClick={() => handleToggleActive(device)}>
                  {device.active ? "Deactivate" : "Reactivate"}
                </button>
              </span>
            </div>
          ))
        )}
        <section className="setting-card">
          <div>
            <b>Optional geolocation rule</b>
            <p className="muted">Enable later to limit direct mobile clock-ins to approved locations.</p>
          </div>
          <label className="switch"><input type="checkbox" /><span /></label>
        </section>
      </section>
    </>
  );
}

function RegisterKioskModal({ onClose, onRegistered }: { onClose: () => void; onRegistered: (device: RegisteredDevice) => void }) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const device = await registerDevice(label);
      onRegistered(device);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't register the kiosk.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Register kiosk</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="muted small">Creates a restricted attendance device with a one-time PIN. Give the PIN to whoever sets up the shared tablet — it's shown once and can't be retrieved later, only regenerated.</p>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            Device label
            <input required value={label} onChange={(e) => setLabel(e.target.value)} disabled={saving} placeholder="e.g. Front desk tablet" />
          </label>
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Registering…" : "Register"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function KioskPinModal({ label, pin, onClose }: { label: string; pin: string; onClose: () => void }) {
  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>{label}</h2>
          <button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="muted small">This PIN won't be shown again. Write it down or share it with whoever's setting up the device now.</p>
        <p className="kiosk-pin">{pin}</p>
        <div className="admin-modal-actions">
          <button className="primary-admin" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Settings({ setNotice }: NoticeProps) {
  return (
    <section className="panel settings-panel">
      <Setting title="Company details" text="HR representative, leave year and date format" />
      <Setting title="Attendance rules" text="QR kiosk, mobile buttons, web check-in and geolocation" />
      <Setting title="Leave policies" text="Types, entitlements, approvals and holidays" />
      <Setting title="Audit log" text="Review sensitive platform activity" />
      <button className="primary-admin" onClick={() => setNotice("Settings persist directly to Supabase once the settings tables are added.")}>Save settings</button>
    </section>
  );
}

function Toolbar({
  action,
  onAction,
  onExport,
  exporting,
}: {
  action: string;
  onAction: () => void;
  onExport?: () => void;
  exporting?: boolean;
}) {
  return (
    <div className="toolbar">
      <div className="search-input"><Icon name="search" size={15} /><input placeholder="Search" /></div>
      <button className="outline-button"><Icon name="filter" size={15} /> Filters</button>
      {onExport && (
        <button className="outline-button" onClick={onExport} disabled={exporting}>
          <Icon name="download" size={15} /> {exporting ? "Exporting…" : "Export"}
        </button>
      )}
      <button className="primary-admin" onClick={onAction}><Icon name="plus" size={15} /> {action}</button>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section className="stat">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}

function Setting({ title, text }: { title: string; text: string }) {
  return (
    <button>
      <span><b>{title}</b><small>{text}</small></span>
      <Icon name="chevronRight" size={16} className="muted-icon" />
    </button>
  );
}

function LoadingPanel() {
  return (
    <section className="panel loading-panel">
      <Icon name="spinner" size={20} className="spin" />
      <span className="muted">Loading…</span>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="panel error-panel">
      <Icon name="warning" size={18} />
      <span>{message}</span>
    </section>
  );
}

function EmptyPanel({ icon, title, note }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; note: string }) {
  return (
    <section className="panel empty-panel">
      <Icon name={icon} size={30} className="muted-icon" />
      <h2>{title}</h2>
      <p className="muted">{note}</p>
    </section>
  );
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function stateLabel(state: string) {
  return { not_started: "⏳ Not started", working: "🟢 Working", on_break: "☕ On break", on_lunch: "🍽️ On lunch", complete: "✅ Complete" }[state] ?? state;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString([], { day: "2-digit", month: "short" });
}
