// Supabase Edge Function: create-employee
//
// Invites a new employee by email (Supabase Auth invite) and creates their
// `profiles` row. Must run server-side because it uses the service-role key
// to call the Auth admin API — never expose that key to the browser.
//
// Deploy with: supabase functions deploy create-employee

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

const VALID_ROLES = ["employee", "manager", "hr_admin", "kiosk"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Client scoped to the caller's own JWT, used only to verify who is calling.
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
    return json({ error: "Only HR administrators can add employees." }, 403);
  }

  let body: { fullName?: string; email?: string; employeeCode?: string; role?: string; teamId?: string | null; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const fullName = body.fullName?.trim();
  const email = body.email?.trim().toLowerCase();
  const employeeCode = body.employeeCode?.trim();
  const role = body.role?.trim() ?? "employee";
  const teamId = body.teamId?.trim() || null;

  if (!fullName) return json({ error: "Full name is required." }, 400);
  if (!email) return json({ error: "Email is required." }, 400);
  if (!employeeCode) return json({ error: "Employee code is required." }, 400);
  if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role." }, 400);

  if (teamId) {
    const { data: team } = await adminClient.from("teams").select("id").eq("id", teamId).maybeSingle();
    if (!team) {
      return json({ error: "Selected team is invalid." }, 400);
    }
  }

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirectTo || undefined,
  });
  if (inviteError || !invited.user) {
    return json({ error: inviteError?.message ?? "Couldn't send the invite." }, 400);
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .insert({ id: invited.user.id, full_name: fullName, employee_code: employeeCode, role, team_id: teamId })
    .select("id,full_name,employee_code,role,team_id")
    .single();

  if (profileError) {
    // Roll back the invited auth user so a failed profile insert doesn't leave an orphan account.
    await adminClient.auth.admin.deleteUser(invited.user.id);
    return json({ error: profileError.message }, 400);
  }

  return json({
    id: profile.id,
    fullName: profile.full_name,
    employeeCode: profile.employee_code,
    role: profile.role,
    teamId: profile.team_id,
  });
});
