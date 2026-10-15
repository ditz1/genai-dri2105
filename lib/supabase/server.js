import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseUrl, supabaseKey } from './env';

// Per-request client that reads the signed-in user's session from cookies.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can't write cookies; proxy.js keeps the session fresh instead.
        }
      },
    },
  });
}

// The signed-in user, their profile row and whether they are an admin, or nulls when signed out.
export async function getUserAndProfile() {
  if (!supabaseUrl || !supabaseKey) return { supabase: null, user: null, profile: null, isAdmin: false };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null, isAdmin: false };
  const [{ data: profile }, { data: isAdmin }] = await Promise.all([
    supabase.from('profiles').select('first_name, last_name, avatar_path, created_at').eq('id', user.id).maybeSingle(),
    supabase.rpc('is_admin'),
  ]);
  return { supabase, user, profile, isAdmin: isAdmin === true };
}

export function hasName(profile) {
  return Boolean(profile?.first_name?.trim() && profile?.last_name?.trim());
}
