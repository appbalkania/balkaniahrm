// Supabase query errors resolve as plain `{ message, code, details, hint }`
// objects, not Error instances (postgrest-js only wraps them in `PostgrestError`
// when `.throwOnError()` is used, which this codebase doesn't). An `err
// instanceof Error` check therefore misses every backend/RLS/trigger message
// — including the ones triggers raise specifically to explain a rejection —
// and silently falls back to a generic string instead. Duck-type on `.message`
// so both real Error instances and Supabase's plain error objects are covered.
export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
