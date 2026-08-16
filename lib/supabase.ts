import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null | undefined;

export function createSupabaseBrowserClient() {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cachedClient = null;
    return cachedClient;
  }
  cachedClient = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return cachedClient;
}
