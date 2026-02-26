import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing Supabase environment variables. Check SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
  );
}

/**
 * Public client - uses anon key, respects Row Level Security (RLS).
 * Used to verify user JWTs passed from the frontend.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Admin client - uses service role key, BYPASSES RLS.
 * Use only in server-side code after the user has been authenticated.
 * NEVER expose this client or its key to the frontend.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
