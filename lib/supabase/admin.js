import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from './env';

// Server-only client with the project's secret key, which bypasses row level security.
// Used only to save the day's theme the first time someone needs it; returns null when the key isn't set.
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return null;
  return createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
