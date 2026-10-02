import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUserAndProfile, hasName } from '../../lib/supabase/server';
import GoogleButton from './google-button';

export const metadata = { title: 'Log in' };

export default async function Login({ searchParams }) {
  const { user, profile } = await getUserAndProfile();
  if (user) redirect(hasName(profile) ? '/profile' : '/onboarding');
  const { error } = await searchParams;
  return (
    <main className="page">
      <div className="card">
        <h1>Log in</h1>
        <p>Sign in or create an account with Google.</p>
        {error && <p className="error" role="alert">Sign-in failed. Try again.</p>}
        <GoogleButton />
        <Link href="/">Back to the board</Link>
      </div>
    </main>
  );
}
