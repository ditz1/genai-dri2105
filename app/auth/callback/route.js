import { redirect } from 'next/navigation';
import { createClient, hasName } from '../../../lib/supabase/server';

// Google sends the user back here; trade the code for a session, then route by profile completeness.
// Redirects are relative so the browser stays on the host that holds the session cookies.
export async function GET(request) {
  const code = new URL(request.url).searchParams.get('code');
  if (!code) redirect('/login?error=1');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('Failed to exchange auth code:', error.message);
    redirect('/login?error=1');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', data.user.id)
    .maybeSingle();
  redirect(hasName(profile) ? '/profile' : '/onboarding');
}
