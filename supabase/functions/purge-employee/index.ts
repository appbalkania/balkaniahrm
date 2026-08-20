// Supabase Edge Function: purge-employee
//
// Permanently deletes an employee AND all their historical records
// (attendance, leave, disciplinary) plus clears any team/department they
// manage. This is irreversible and destroys audit history that "Delete"
// deliberately refuses to touch -- use Deactivate for normal offboarding.
// Only for genuine cleanup: test data, or an account created by mistake
// that's since accumulated records.
//
// Deploy with: supabase functions deploy purge-employee

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser();
  if (!caller) return json({ error: "Authentication required." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerProfile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();
  if (!callerProfile || callerProfile.role !== "hr_admin") {
    return json({ error: "Only HR administrators can purge employees." }, 403);
  }

  let body: { employeeId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const employeeId = body.employeeId?.trim();
  if (!employeeId) return json({ error: "employeeId is required." }, 400);
  if (employeeId === caller.id) return json({ error: "You can't purge your own account." }, 400);

  const cleanupSteps: Array<[string, () => Promise<{ error: { message: string } | null }>]> = [
    ["attendance events", () => adminClient.from("attendance_events").delete().eq("employee_id", employeeId)],
    ["attendance sessions", () => adminClient.from("attendance_sessions").delete().eq("employee_id", employeeId)],
    ["leave requests", () => adminClient.from("leave_requests").delete().eq("employee_id", employeeId)],
    ["leave balances", () => adminClient.from("leave_balances").delete().eq("employee_id", employeeId)],
    ["disciplinary records", () => adminClient.from("disciplinary_actions").delete().eq("employee_id", employeeId)],
    ["team management", () => adminClient.from("teams").update({ manager_id: null }).eq("manager_id", employeeId)],
    ["department management", () => adminClient.from("departments").update({ manager_id: null }).eq("manager_id", employeeId)],
  ];

  for (const [label, run] of cleanupSteps) {
    const { error } = await run();
    if (error) return json({ error: `Couldn't clear ${label}: ${error.message}` }, 400);
  }

  const { error } = await adminClient.auth.admin.deleteUser(employeeId);
  if (error) {
    return json(
      { error: `Couldn't fully purge this employee: ${error.message}. They may have issued disciplinary actions to other employees, which must be reassigned first.` },
      400,
    );
  }

  return json({ id: employeeId });
});
