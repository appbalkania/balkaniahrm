# AveHR Development Guide

## Purpose

This document records the user-facing functionality observed in the authenticated AveHR tenant and turns it into a practical development baseline. It describes the current product behaviour, not the underlying source code or API implementation.

## Balkania product direction

Build a dedicated, single-tenant Balkania HR and attendance product rather than a multi-company SaaS. The product will have two clients that share one backend and one employee identity:

- **Balkania Admin Web**: a browser-based portal for HR, managers, payroll/finance, and company administrators.
- **Balkania Check-in Mobile**: an employee-facing iOS and Android app focused on secure clock-in/out, break tracking, attendance history, leave visibility, schedules, and notifications.

The mobile app should not begin as a copy of the full HR administration portal. Its first release should make employee attendance quick and reliable while the web application remains the system of record and operational workspace.

## Proposed technical architecture

| Layer | Recommended technology | Responsibility |
| --- | --- | --- |
| Web app | Next.js + TypeScript | Balkania HR admin portal, manager dashboards, reporting, settings, and responsive employee self-service. |
| Mobile app | Expo / React Native + TypeScript | Native iOS and Android check-in experience, push notifications, device capabilities, and offline-safe attendance capture. |
| Hosting | Vercel | Deploy the Next.js web app, preview environments, server routes, scheduled jobs where suitable, and environment configuration. |
| Backend | Supabase | Postgres database, authentication, Row Level Security, Storage for documents, Realtime updates, and Edge Functions for trusted server workflows. |
| Shared code | TypeScript monorepo | Shared domain types, validation, API client, authorization helpers, and design tokens between web and mobile. |

### Deployment model

- Use one **production** Supabase project and Vercel project for Balkania.
- Use separate **staging** Supabase and Vercel projects before production releases.
- Connect Vercel to the source-control repository so pull requests produce preview deployments.
- Keep service-role credentials exclusively in server-side Vercel functions or Supabase Edge Functions; never ship them to the web or mobile app.
- Use database migrations and seed data tracked in source control; do not make production schema changes manually in the dashboard.

## MVP scope

### Mobile: Balkania Check-in

1. Secure employee sign-in and logout.
2. Clock in, start/end break, and clock out.
3. Show current attendance state and today's worked/break time.
4. Show personal attendance history, lateness/absence status, and assigned schedule.
5. Show leave balance, leave requests, and approved leave on the schedule.
6. Push reminders for missed clock-in/out and approved/rejected leave.
7. Capture an auditable check-in context: timestamp, selected work mode (office/remote/manual where allowed), optional location policy result, and device metadata.
8. Queue check-in events locally when offline and submit them safely when a connection is restored.

## Mobile employee experience (screen specification)

The supplied AveHR mobile screenshots are the functional and visual reference for the first Balkania employee app. Replace AveHR branding with Balkania branding, but retain the simple five-item navigation model:

| Navigation item | Screen purpose | Required content and actions |
| --- | --- | --- |
| Home | Personal work summary and shortcuts | Greeting, selected-month summary, average check-in/out, notifications, profile entry, configurable quick tools, and a calendar summary. |
| Leaves | Leave self-service | Personal leave requests, leave balance/entitlement, request creation, sick-day declaration, status filtering, and an optional manager-only team tab. |
| Check-in action | Fast attendance action hub | Clock in/out, start/end lunch, start/end first break, visible current state, and guidance when the employee has not started work. |
| Tracking | Personal attendance detail | Today/month/date views; working, first-break, and lunch-break cards; durations; start/end times; and exception state. |
| Profile | Personal settings and resources | Personal details, language, notification controls, location/camera permissions, custom notifications, documents, and account actions. |

### Home screen

- Display a time-aware greeting with the employee name.
- Show a month selector and monthly attendance summary, including average check-in and check-out times.
- Display a small attendance heat map/calendar: no attendance, missed attendance, and graduated worked-time intensity must be visually distinct and accessible without relying on colour alone.
- Offer configurable quick tools. Initial options may include integrations, shift swap, inventory/assets, and holidays; only show tools the employee is authorized to use.
- Show a notification badge and a profile shortcut in the header.

### Attendance action hub

The centre navigation action opens a dedicated, low-friction attendance screen rather than hiding clock events inside a menu.

- Show a reminder when the employee has not begun their scheduled remote or office workday.
- Present enabled actions as large touch targets: **Clock in**, **Clock out**, **Lunch in**, **Lunch out**, **First break in**, and **First break out**.
- Disable or hide invalid actions based on the server-calculated state. For example, an employee cannot clock out before clocking in or end a break that has not started.
- After every action, show a confirmation containing the authoritative server timestamp, selected work mode, and any relevant validation result.
- If a check-in requires a QR scan, location check, or photo/camera verification, request the device permission only at the moment it is needed and explain why it is needed.

### QR company-device attendance mode

- Support a **PWA employee mode** and a **PWA kiosk mode**; neither requires a native mobile application.
- In employee mode, the central check-in action displays a personal QR code which rotates frequently and is bound to the signed-in employee.
- In kiosk mode, a shared tablet signs in with a restricted attendance-device account, scans the employee QR code through its camera, and submits the event for server validation.
- The kiosk receives only a success/failure result and the minimum necessary employee display information. It must not expose HR records, leave balances, or passwords.
- Store kiosk credentials separately from employee sessions. Administrators can regenerate the device PIN and revoke a kiosk session.
- Geolocation remains an optional policy for both QR-device and direct mobile-button attendance modes.

### Attendance tracking

- Default to **Today**, with **This month** and specific-date selection.
- Use separate cards for working time, first-break time, and lunch-break time.
- Each card shows total duration plus clock-in and clock-out timestamps.
- Clearly distinguish no record, active session, completed session, missing clock-out, late, absent, and corrected attendance.
- Allow the employee to submit an attendance correction request with a reason; do not allow silent editing of historical clock events.

### Leave and sick-day self-service

- The **My leaves** tab lists pending, approved, rejected, cancelled, and historical requests. Swipe actions should be supplemented by visible accessible actions.
- The request form requires leave type, start/end dates, duration (full/half day where enabled), optional note, and supporting document when policy requires it.
- Provide a separate **Declare sick day** action that records the medical leave type, dates, note, and any required evidence. It must use the same approval, entitlement, notification, and audit workflow as other leave requests.
- Show annual and medical leave balance separately. The balance view must explain **entitled**, **earned**, **used**, **available**, and **not yet earned** values, matching the supplied visual reference.
- Prevent a request from exceeding available balance, conflicting with an approved absence, or violating company policy unless the policy explicitly permits it; return a helpful explanation.
- Manager-capable users may see **My team** to review team leave, but this must be absent for ordinary employees without that permission.

### Profile, documents, and device preferences

- Allow employees to edit only permitted personal details.
- Support language selection and per-category notification preferences.
- Surface current location and camera permission states without collecting location/camera data merely for viewing settings.
- Give employees access to their own assigned documents and policy acknowledgements through secured downloads.
- Support sign-out and account/session management.

### Mobile API and data requirements

- `GET /me/dashboard`: greeting, quick tools, notifications, monthly summary, and calendar activity.
- `GET /me/attendance` and `GET /me/attendance/:date`: personal attendance summaries and events.
- `POST /attendance-events`: idempotent clock, lunch, and break events; server validates state and returns the updated session.
- `GET /me/leave-balances`, `GET /me/leave-requests`, `POST /leave-requests`: balances and leave/sick-day workflows.
- `GET /me/schedule`, `GET /me/documents`, `GET /me/notifications`: employee self-service data.
- `POST /devices/push-tokens`: secure registration and removal of mobile push tokens.

In Supabase, these routes may be implemented through typed client queries for read-only employee-owned data and Edge Functions for state transitions, approvals, security-sensitive validation, exports, and notification dispatch.

### Web: Balkania Admin

1. Employee directory, onboarding, archive status, CSV import, and organisation structure.
2. Attendance dashboard, live attendance list, corrections/exception workflow, reporting, export, overtime, and violations.
3. Leave types, entitlements, request approval, scheduler, and reporting.
4. Work schedules, shifts, rotations, and swap requests.
5. Documents, contracts, training/certifications, assets, company events, and notifications.
6. Recruitment, performance, payroll, integrations, billing, and audit logs may follow in later releases unless already required for the initial Balkania rollout.

## Attendance rules for the mobile app

- A mobile check-in creates an immutable event; corrections must create a separate adjustment with reason, actor, and audit timestamp.
- The backend calculates the current attendance session from clock and break events. Do not trust client-calculated hours.
- Enforce one active attendance session and one active break per employee.
- Apply the employee's assigned schedule, holiday, approved leave, branch, and permission rules on the server.
- Use idempotency keys for every event so retries and offline replay cannot create duplicate clock-ins.
- If location validation is required, decide the exact policy before implementation: permitted radius/locations, when location is collected, whether a failed check-in is blocked or flagged, retention period, and employee notice/consent requirements.

## Supabase data model baseline

All business tables belong to the single Balkania tenant. Include `company_id` only if future multi-company expansion is plausible; otherwise avoid tenant abstraction that Balkania does not need today.

- `profiles`: employee identity linked 1:1 to `auth.users`.
- `employees`, `branches`, `departments`, `teams`, `roles`, `job_positions`.
- `work_schedules`, `shifts`, `shift_assignments`, `holidays`.
- `attendance_events`: immutable clock-in/out and break events with idempotency key, source, and review status.
- `attendance_sessions`: derived daily/session record used for reporting.
- `leave_types`, `leave_balances`, `leave_requests`, `leave_approvals`.
- `documents`, `document_assignments`, `assets`, `asset_assignments`.
- `notifications`, `push_devices`, `audit_log`.

Enable Row Level Security on every exposed table. Employees should access only their own records; managers only records in their reporting scope; HR/payroll/admin roles receive explicitly defined additional policies. Use server-side functions for privileged calculations, approvals, exports, and any workflow that changes multiple records.

## Suggested repository structure

```text
balkania-hrm/
  apps/
    web/                 # Next.js app deployed to Vercel
    mobile/              # Expo / React Native app
  packages/
    domain/              # Shared types, schemas, attendance rules
    supabase/            # Typed Supabase clients and queries
    ui-tokens/           # Colours, typography, spacing
  supabase/
    migrations/          # Versioned PostgreSQL migrations
    functions/           # Edge Functions for trusted workflows
    seed.sql
```

## Release phases

1. **Foundation** — repository, environments, Supabase Auth, profiles, roles, RLS, audit log, design system, and CI/CD.
2. **Attendance MVP** — employee import, schedules, mobile clock events, admin attendance dashboard, reports, corrections, and notifications.
3. **Leave and scheduling** — balances, requests/approvals, holidays, scheduler, rotations, and swap requests.
4. **HR operations** — documents, assets, training, recruitment, performance, and integrations.
5. **Payroll and finance** — payroll workflows, finance exports, invoices, and advanced analytics.

## Product overview

AveHR is a role-based human-resources platform for managing an organisation, employees, recruitment, leave, attendance, scheduling, payroll, assets, documents, performance, integrations, and billing.

Primary user roles inferred from the available screens include HR administrators/managers, employees, and payroll or finance administrators. All capabilities should be permission-controlled.

## Main navigation and modules

| Area | Current functions |
| --- | --- |
| Dashboard | Operational metrics, attendance insights, leave/birthday/anniversary summaries, expiring contracts and documents, recruitment summary, department chart, demographic statistics, upcoming events, staff overview, retention and turnover metrics, date filters, and metric export. |
| Organisation | Branches, departments, teams, roles, job positions, holidays, holiday planner, leave types, contract templates, and company events. |
| Staff directory | Active, archived, and pending employees; search, filters, date range, CSV import, employee creation, and all-employee code/link download. |
| Documents | Company documents, employee documents, and employee contracts with search, filters, downloads, and new-document creation. |
| Training & certifications | Training catalogue, archive, personal training, certificates, training assignment, approval, progress, completion, and accomplishment monitoring. |
| Recruitment | Job postings, candidates, talent pools, recruitment settings, job creation, job export, and configurable recruitment flow. |
| Leave management | Leave requests, entitlement management, manager review, scheduler, reports, violations, employee/team/personal leave views, filters, and export. |
| Performance | Review cycles, objectives and goals, analytics, review administration, cycle status, completion tracking, and activity history. |
| Payroll | Payroll periods, payroll reports, payroll settings, search, status filtering, and payroll-period creation. |
| Time tracking | Attendance list, personal attendance, scheduler, reporting, overtime, attendance violations, working/absent/completed counts, break tracking, QR check-in, automatic clock-out, and manual/remote/office attendance modes. |
| Work schedules | Shift templates, shifts, rotations, rotation calendar, swap requests, personal swap requests, and weekly working-hour templates. |
| Asset management | Assets, assignments, reported assets, archived assets, categories, availability/state summaries, asset import, asset creation, search, and filtering. |
| Integrations | Integration marketplace and connection status for calendar, Teams/Slack status, recruiting calendars, e-signature, accounting/payroll export, and job-board publishing. |
| Settings | General company configuration, attendance, leave, appearance, billing, audit log, HR representative, leave-year start, date format, and sender email. |
| Billing | Invoices, billing details, financial statement, invoice filtering/export, payment status, per-employee cost, employee count, and payment action. |

## Core workflows

### 1. Organisation setup

1. Configure company details, HR representative, leave-year start, date format, and sender email.
2. Create branches, departments, teams, roles, and job positions.
3. Configure leave types, holidays, contract templates, and company events.
4. Create working-hour, shift, and rotation templates.

### 2. Employee lifecycle

1. Add an employee individually or import employees via CSV.
2. Maintain active, archived, and pending employee states.
3. Attach employee documents/contracts, training, assets, leave entitlements, schedule, payroll, and performance information.
4. Archive employees rather than removing historical data.

### 3. Time and attendance

1. Employees clock in/out through supported attendance modes.
2. The system records working time, breaks, lateness, absence, overtime, and unfinished days.
3. Managers filter by employee, date, branch, department, team, and status.
4. Attendance reports calculate working hours, punctuality, leave hours, paid/unpaid breaks, and exceptions.

### 4. Leave management

1. Employees submit leave requests.
2. Managers review and approve/reject requests.
3. Approved leave appears in the scheduler and reporting.
4. Entitlements, violations, calendars, and exports provide operational oversight.

### 5. Recruitment to onboarding

1. HR creates and publishes job postings.
2. Candidates progress through the recruitment workflow and may be grouped in talent pools.
3. Interviews can be synced to Google or Outlook calendars through integrations.
4. Hired candidates should transition to employee records without duplicate data entry.

### 6. Payroll and billing

1. Payroll administrators create and manage payroll periods.
2. Payroll reports and configuration support downstream finance processing.
3. Company billing presents invoices, employee counts, per-employee price, status, export, and payment action.

## Key entities

- Company, branch, department, team, role, job position
- Employee, employment status, contract, document, certification, training
- Candidate, job posting, talent pool, interview
- Leave request, leave type, entitlement, holiday, violation
- Attendance record, clock event, break, overtime, schedule, shift, rotation, swap request
- Performance cycle, review, objective, goal
- Payroll period and payroll report
- Asset, category, assignment, condition/report
- Integration connection, synchronization status, audit-log entry
- Invoice, billing plan, payment status

## Development requirements

### Access control

- Enforce role-based access control for every module and action.
- Separate employee self-service data from manager, HR, payroll, finance, and company-administrator access.
- Keep audit records for sensitive changes: employee lifecycle, attendance edits, leave decisions, payroll, billing, integration connections, and settings.

### Data and reporting

- Preserve historical employee, attendance, leave, payroll, and invoice data after archival or organisational changes.
- Apply branch/department/team filters consistently across lists and reports.
- Support server-side filtering, pagination, sortable lists, date ranges, and export for high-volume data.
- Use a single source of truth for attendance-derived metrics, scheduler availability, leave hours, overtime, and dashboard cards.

### Integrations

- Use OAuth or provider-approved authorization flows for Google, Microsoft, Slack, and other external services.
- Store connection state, scope, last synchronization, failures, retries, and user-visible remediation guidance.
- Make all outbound synchronization idempotent to prevent duplicate calendar events, status updates, or exports.

### Security and privacy

- Treat employee, attendance, contract, payroll, and billing records as sensitive personal data.
- Encrypt data in transit and at rest; never expose credentials or tokens in the client.
- Use signed, expiring downloads for documents and CSV exports.
- Record consent/authorization boundaries for third-party integrations.

## Recommended acceptance criteria

1. An HR administrator can configure organisation structure and add/import employees.
2. An employee can submit leave and view personal attendance without accessing other employees' private data.
3. A manager can review direct-report leave and attendance, with filters matching their organisational scope.
4. An attendance report reconciles clock events, breaks, leave, overtime, and punctuality for a chosen period.
5. The monthly scheduler reflects approved leave and configured working schedules.
6. HR can create a job, manage candidates, and trigger an interview-calendar integration when connected.
7. Payroll and billing users can view only authorized financial data and export reports/invoices safely.
8. Every export, approval, connection change, and sensitive update is traceable in the audit log.

## Discovery notes

- The guide is based on an authenticated functional review performed on 16 August 2026.
- Observed labels and availability may change by tenant configuration, user permissions, subscription, or feature flags.
- No records were created, edited, deleted, paid, exported, or connected during the review.
