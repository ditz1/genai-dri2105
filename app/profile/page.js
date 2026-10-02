import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOut } from '../actions';
import { getUserAndProfile, hasName } from '../../lib/supabase/server';
import ProfileForm from './profile-form';

export const metadata = { title: 'Your profile' };

export default async function Profile() {
  const { supabase, user, profile } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!hasName(profile)) redirect('/onboarding');
  const avatarUrl = profile.avatar_path
    ? supabase.storage.from('avatars').getPublicUrl(profile.avatar_path).data.publicUrl
    : null;
  return (
    <main className="page">
      <div className="card">
        <h1>Your profile</h1>
        <dl>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Member since</dt>
          <dd>{new Date(profile.created_at).toLocaleDateString('en-US', { dateStyle: 'long' })}</dd>
        </dl>
        <ProfileForm userId={user.id} firstName={profile.first_name} lastName={profile.last_name} avatarUrl={avatarUrl} />
        <form action={signOut}>
          <button className="secondary">Sign out</button>
        </form>
        <Link href="/">Back to the board</Link>
      </div>
    </main>
  );
}
