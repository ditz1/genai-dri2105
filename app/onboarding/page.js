import { redirect } from 'next/navigation';
import { getUserAndProfile, hasName } from '../../lib/supabase/server';
import NameForm from './name-form';

export const metadata = { title: 'Finish your profile' };

export default async function Onboarding() {
  const { user, profile } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (hasName(profile)) redirect('/profile');
  return (
    <main className="page">
      <div className="card">
        <h1>Welcome</h1>
        <p>Tell us your name to finish setting up your profile.</p>
        <NameForm firstName={profile?.first_name ?? ''} lastName={profile?.last_name ?? ''} />
      </div>
    </main>
  );
}
