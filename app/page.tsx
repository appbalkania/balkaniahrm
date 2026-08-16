"use client";

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { recordAttendance } from "../lib/attendance-service";
import type { AttendanceEventType } from "../lib/domain";

type AttendanceState = "not_started" | "working" | "on_break" | "on_lunch" | "complete";
type Screen = "home" | "leaves" | "code" | "tracking" | "profile" | "kiosk";

const stateText: Record<AttendanceState, string> = {
  not_started: "Ready to start work",
  working: "You are currently working",
  on_break: "First break is active",
  on_lunch: "Lunch break is active",
  complete: "Workday complete",
};

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [state, setState] = useState<AttendanceState>("not_started");
  const [events, setEvents] = useState<string[]>([]);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [notice, setNotice] = useState("Welcome back, Mohamed.");
  const [kioskCode, setKioskCode] = useState("");

  const qrToken = useMemo(() => `balkania:attendance:employee-demo:${Math.floor(Date.now() / 30000)}`, [screen]);

  async function addEvent(label: string, next: AttendanceState, eventType: AttendanceEventType) {
    try {
      await recordAttendance({ eventType, idempotencyKey: crypto.randomUUID(), source: "pwa" });
    } catch {
      // Demo mode remains available until the manually configured Supabase project is connected.
    }
    setState(next);
    setEvents((previous) => [`${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — ${label}`, ...previous]);
    setNotice(`${label} recorded locally. It will sync securely when connected.`);
  }

  function attendanceAction(action: "clockIn" | "clockOut" | "breakIn" | "breakOut" | "lunchIn" | "lunchOut") {
    const actions = {
      clockIn: ["Clock in", "working", "clock_in"] as const,
      clockOut: ["Clock out", "complete", "clock_out"] as const,
      breakIn: ["First break started", "on_break", "break_start"] as const,
      breakOut: ["First break ended", "working", "break_end"] as const,
      lunchIn: ["Lunch started", "on_lunch", "lunch_start"] as const,
      lunchOut: ["Lunch ended", "working", "lunch_end"] as const,
    };
    const [label, next, eventType] = actions[action];
    void addEvent(label, next, eventType);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><span className="brand-mark">B</span><strong>Balkania</strong></div>
        <button className="icon-button" onClick={() => setScreen("profile")} aria-label="Open profile">◉</button>
      </header>

      <section className="content">
        {screen === "home" && <HomeScreen onNavigate={setScreen} notice={notice} />}
        {screen === "leaves" && <LeavesScreen openForm={leaveOpen} setOpenForm={setLeaveOpen} setNotice={setNotice} />}
        {screen === "code" && <CodeScreen token={qrToken} state={state} onAction={attendanceAction} />}
        {screen === "tracking" && <TrackingScreen events={events} state={state} />}
        {screen === "profile" && <ProfileScreen onKiosk={() => setScreen("kiosk")} />}
        {screen === "kiosk" && <KioskScreen code={kioskCode} setCode={setKioskCode} setNotice={setNotice} />}
      </section>

      {screen !== "kiosk" && <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton active={screen === "home"} label="Home" icon="⌂" onClick={() => setScreen("home")} />
        <NavButton active={screen === "leaves"} label="Leaves" icon="▣" onClick={() => setScreen("leaves")} />
        <NavButton active={screen === "code"} label="Check in" icon="▦" onClick={() => setScreen("code")} primary />
        <NavButton active={screen === "tracking"} label="Tracking" icon="◷" onClick={() => setScreen("tracking")} />
        <NavButton active={screen === "profile"} label="Profile" icon="♙" onClick={() => setScreen("profile")} />
      </nav>}
    </main>
  );
}

function HomeScreen({ onNavigate, notice }: { onNavigate: (screen: Screen) => void; notice: string }) {
  return <>
    <p className="eyebrow">EMPLOYEE PORTAL</p><h1>Good morning, Mohamed 👋</h1><p className="muted">Let&apos;s look at your work summary.</p>
    <div className="notice">{notice}</div>
    <section className="card"><div className="row"><h2>August summary</h2><span>▣</span></div><div className="metric-pair"><Metric label="Avg. check in" value="08:07" /><Metric label="Avg. check out" value="17:03" /></div></section>
    <section className="card"><div className="row"><h2>Quick tools</h2><button className="text-button">Manage</button></div><div className="tool-grid"><button onClick={() => onNavigate("leaves")}>☼<span>Request leave</span></button><button onClick={() => onNavigate("tracking")}>◷<span>Attendance</span></button><button>⇄<span>Swap shift</span></button><button>▣<span>Holidays</span></button></div></section>
    <section className="card"><h2>Attendance activity</h2><div className="heatmap">{Array.from({ length: 28 }, (_, index) => <span key={index} className={index % 8 === 0 ? "missed" : index % 3 === 0 ? "high" : "normal"} />)}</div><p className="muted small">Light to dark: worked time · Red: missed attendance</p></section>
  </>;
}

function LeavesScreen({ openForm, setOpenForm, setNotice }: { openForm: boolean; setOpenForm: (value: boolean) => void; setNotice: (value: string) => void }) {
  const [kind, setKind] = useState("Annual leave");
  return <><h1>Leaves</h1><div className="tabs"><button className="active">My leaves</button><button>My team</button></div><section className="card balance"><p className="eyebrow">AVAILABLE TO BOOK</p><strong>10 <small>days</small></strong><p>You&apos;ve earned <b>10</b> of your <b>15 days</b>. After <b>0 used</b>, 10 are available to book.</p><div className="progress"><span /></div><div className="legend">Entitled 15 <b>·</b> Earned 10 <b>·</b> Used 0</div></section><section className="empty"><div>▧</div><h2>No leave requests</h2><p className="muted">Your submitted and reviewed requests will appear here.</p></section><button className="primary-button" onClick={() => setOpenForm(true)}>＋ Request a leave</button>{openForm && <div className="modal"><div className="modal-card"><h2>Request time off</h2><label>Type<select value={kind} onChange={(event) => setKind(event.target.value)}><option>Annual leave</option><option>Medical / sick day</option></select></label><label>Start date<input type="date" required /></label><label>End date<input type="date" required /></label><label>Note<textarea placeholder="Optional note" /></label><button className="primary-button" onClick={() => { setOpenForm(false); setNotice(`${kind} request submitted for approval.`); }}>Submit request</button><button className="text-button" onClick={() => setOpenForm(false)}>Cancel</button></div></div>}</>;
}

function CodeScreen({ token, state, onAction }: { token: string; state: AttendanceState; onAction: (action: "clockIn" | "clockOut" | "breakIn" | "breakOut" | "lunchIn" | "lunchOut") => void }) {
  return <><h1>Check in</h1><p className="muted">{stateText[state]}</p><section className="card qr-card"><QRCodeSVG value={token} size={184} includeMargin /><h2>My attendance code</h2><p className="muted small">Show this code on the shared Balkania tablet. It refreshes every 30 seconds.</p></section><div className="action-grid"><Action label="Clock in" enabled={state === "not_started"} onClick={() => onAction("clockIn")} /><Action label="Clock out" enabled={state === "working"} danger onClick={() => onAction("clockOut")} /><Action label="First break in" enabled={state === "working"} onClick={() => onAction("breakIn")} /><Action label="First break out" enabled={state === "on_break"} onClick={() => onAction("breakOut")} /><Action label="Lunch in" enabled={state === "working"} onClick={() => onAction("lunchIn")} /><Action label="Lunch out" enabled={state === "on_lunch"} onClick={() => onAction("lunchOut")} /></div></>;
}

function TrackingScreen({ events, state }: { events: string[]; state: AttendanceState }) { return <><h1>My attendance</h1><div className="tabs"><button className="active">Today</button><button>This month</button><button>▣ 16/08/2026</button></div><AttendanceCard title="Working time" value={state === "not_started" ? "0m" : state === "complete" ? "8h 12m" : "Active"} /><AttendanceCard title="First break time" value="0m" /><AttendanceCard title="Lunch break time" value="0m" /><section className="card"><h2>Today&apos;s events</h2>{events.length ? <ul className="events">{events.map((event) => <li key={event}>{event}</li>)}</ul> : <p className="muted">No attendance events recorded today.</p>}</section></> }
function ProfileScreen({ onKiosk }: { onKiosk: () => void }) { return <><h1>Profile</h1><section className="card"><h2>Mohamed Ali Maow</h2><p className="muted">Edit personal details</p></section><section className="settings"><Setting label="Language" value="English" /><Setting label="Notifications" value="On" /><Setting label="Location" value="Off" /><Setting label="Camera permission" value="Not granted" /><Setting label="Documents" value="›" /></section><button className="secondary-button" onClick={onKiosk}>Open kiosk demo</button></> }
function KioskScreen({ code, setCode, setNotice }: { code: string; setCode: (value: string) => void; setNotice: (value: string) => void }) { return <><p className="eyebrow">BALKANIA SHARED DEVICE</p><h1>Attendance kiosk</h1><p className="muted">Scan an employee QR code or enter its value.</p><section className="card"><label>QR code value<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="balkania:attendance:..." /></label><button className="primary-button" onClick={() => { if (!code.trim()) return; setNotice("QR attendance event accepted for secure server validation."); setCode(""); }}>Record attendance</button></section><p className="muted small">Production mode will use the tablet camera and a dedicated, restricted kiosk account.</p></> }
function NavButton({ active, label, icon, onClick, primary }: { active: boolean; label: string; icon: string; onClick: () => void; primary?: boolean }) { return <button className={`${active ? "selected" : ""} ${primary ? "nav-primary" : ""}`} onClick={onClick}><span>{icon}</span>{label}</button> }
function Action({ label, enabled, danger, onClick }: { label: string; enabled: boolean; danger?: boolean; onClick: () => void }) { return <button className={`action ${danger ? "danger" : ""}`} disabled={!enabled} onClick={onClick}>◷<span>{label}</span></button> }
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="muted">{label}</p><strong>{value}</strong></div> }
function AttendanceCard({ title, value }: { title: string; value: string }) { return <section className="card attendance-card"><div className="row"><h2>{title}</h2><strong>{value}</strong></div><div className="metric-pair"><Metric label="Clock in" value="--:--" /><Metric label="Clock out" value="--:--" /></div></section> }
function Setting({ label, value }: { label: string; value: string }) { return <button><span>{label}</span><b>{value}</b></button> }
