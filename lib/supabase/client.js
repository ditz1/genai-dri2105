import { createBrowserClient } from '@supabase/ssr';
import { supabaseUrl, supabaseKey } from './env';

// Browser client; the session lives in cookies so the server can read it too.
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseKey);
}
