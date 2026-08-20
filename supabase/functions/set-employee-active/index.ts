// Supabase Edge Function: set-employee-active
//
// Deactivates or reactivates an employee: flips profiles.active and bans/
// unbans their auth.users row so a deactivation takes effect immediately
// (new sign-ins and token refreshes are rejected right away), not just at
// the app level. Must run server-side because it uses the service-role key
// to call the Auth admin API — never expose that key to the browser.
//
// Deploy with: supabase functions deploy set-employee-active

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
    return json({ error: "Only HR administrators can manage employee status." }, 403);
  }

  let body: { employeeId?: string; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const employeeId = body.employeeId?.trim();
  if (!employeeId) return json({ error: "employeeId is required." }, 400);
  if (typeof body.active !== "boolean") return json({ error: "active must be true or false." }, 400);
  if (employeeId === caller.id && !body.active) return json({ error: "You can't deactivate your own account." }, 400);

  const { error: profileError } = await adminClient.from("profiles").update({ active: body.active }).eq("id", employeeId);
  if (profileError) return json({ error: profileError.message }, 400);

  const { error: banError } = await adminClient.auth.admin.updateUserById(employeeId, {
    // ~100 years -- effectively permanent until reactivated.
    ban_duration: body.active ? "none" : "876000h",
  });
  if (banError) return json({ error: banError.message }, 400);

  return json({ id: employeeId, active: body.active });
});
