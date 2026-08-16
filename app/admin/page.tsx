"use client";

import { useEffect, useState } from "react";
import "./admin.css";
import { Icon } from "../../components/icons";
import { getCurrentSession, onAuthStateChange, signInWithPassword, signOut, supabaseConfigured } from "../../lib/auth-service";
import { getMyProfile } from "../../lib/employee-service";
import type { Profile } from "../../lib/domain";
import {
  createEmployee,
  getDashboardStats,
  listAttendanceDevices,
  listAttendanceSessions,
  listEmployees,
  listPendingLeaveRequests,
  listWorkSchedules,
  reviewLeaveRequest,
  type AdminAttendanceSession,
  type AdminEmployee,
  type AdminLeaveRequest,
  type AdminWorkSchedule,
  type DashboardStats,
} from "../../lib/admin-service";

type Module = "dashboard" | "employees" | "attendance" | "leaves" | "schedules" | "devices" | "settings";
type AuthStatus = "loading" | "signedOut" | "forbidden" | "signedIn";

const modules: Array<[Module, string, Parameters<typeof Icon>[0]["name"]]> = [
  ["dashboard", "Dashboard", "layout"],
  ["employees", "Employees", "users"],
  ["attendance", "Attendance", "clock"],
  ["leaves", "Leave management", "calendar"],
  ["schedules", "Work schedules", "swap"],
  ["devices", "Kiosk devices", "device"],
  ["settings", "Settings", "settings"],
];

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

function AdminShell({ profile }: { profile: Profile }) {
  const [module, setModule] = useState<Module>("dashboard");
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
        <p>HR ADMIN</p>
        {modules.map(([id, label, icon]) => (
          <button key={id} className={module === id ? "active" : ""} onClick={() => setModule(id)}>
            <Icon name={icon} size={17} />
            {label}
          </button>
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
            <button className="outline-button"><Icon name="download" size={15} /> Export</button>
            <button className="avatar">{initials(profile.fullName)}</button>
          </div>
        </header>
        {notice && <p className="admin-notice">{notice}</p>}
        {module === "dashboard" && <Dashboard onNavigate={setModule} />}
        {module === "employees" && <Employees setNotice={setNotice} />}
        {module === "attendance" && <Attendance setNotice={setNotice} />}
        {module === "leaves" && <Leaves setNotice={setNotice} />}
        {module === "schedules" && <Schedules setNotice={setNotice} />}
        {module === "devices" && <Devices setNotice={setNotice} />}
        {module === "settings" && <Settings setNotice={setNotice} />}
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

  function load() {
    listEmployees()
      .then((data) => setRows(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load employees."));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <Toolbar action="Add employee" onAction={() => setShowAddModal(true)} />
      {showAddModal && (
        <AddEmployeeModal
          onClose={() => setShowAddModal(false)}
          onCreated={(employee) => {
            setShowAddModal(false);
            setRows((prev) => [...(prev ?? []), employee].sort((a, b) => a.fullName.localeCompare(b.fullName)));
            setNotice(`Invited ${employee.fullName}. They'll receive an email to set their password.`);
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
          <div className="table-head"><b>Employee</b><b>Code</b><b>Role</b><b>Status</b></div>
          {rows.map((row) => (
            <div className="table-row" key={row.id}>
              <span><i className="person-dot">{row.fullName[0]}</i>{row.fullName}</span>
              <span>{row.employeeCode}</span>
              <span className="capitalize">{row.role.replace("_", " ")}</span>
              <span className="pill success">Active</span>
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const employee = await createEmployee({ fullName, email, employeeCode, role });
      onCreated(employee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
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
          {error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}
          <div className="modal-actions">
            <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-admin" type="submit" disabled={saving}>{saving ? "Sending invite…" : "Send invite"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Attendance({ setNotice }: NoticeProps) {
  const [rows, setRows] = useState<AdminAttendanceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let active = true;
    listAttendanceSessions(today)
      .then((data) => active && setRows(data))
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load attendance."));
    return () => {
      active = false;
    };
  }, [today]);

  const working = rows?.filter((r) => r.state === "working" || r.state === "on_break" || r.state === "on_lunch").length ?? 0;
  const complete = rows?.filter((r) => r.state === "complete").length ?? 0;

  return (
    <>
      <Toolbar action="Review exceptions" onAction={() => setNotice("Attendance exceptions are drawn from attendance_sessions and attendance_events.")} />
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

function Leaves({ setNotice }: NoticeProps) {
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
  const [rows, setRows] = useState<Array<{ id: string; label: string; active: boolean }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAttendanceDevices()
      .then((data) => active && setRows(data as Array<{ id: string; label: string; active: boolean }>))
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load kiosk devices."));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Toolbar action="Register kiosk" onAction={() => setNotice("Kiosk registration creates a restricted attendance_devices record and one-time PIN.")} />
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
                <p className="muted">{device.active ? "Active" : "Inactive"} · Restricted kiosk account</p>
              </div>
              <button className="outline-button">Regenerate PIN</button>
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

function Toolbar({ action, onAction }: { action: string; onAction: () => void }) {
  return (
    <div className="toolbar">
      <div className="search-input"><Icon name="search" size={15} /><input placeholder="Search" /></div>
      <button className="outline-button"><Icon name="filter" size={15} /> Filters</button>
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
  return { not_started: "Not started", working: "Working", on_break: "On break", on_lunch: "On lunch", complete: "Complete" }[state] ?? state;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString([], { day: "2-digit", month: "short" });
}
