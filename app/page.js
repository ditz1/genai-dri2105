import Link from 'next/link';
import { getUserAndProfile } from '../lib/supabase/server';
import Board from './board';
import { boardSize, placeholderProfiles } from './placeholders';

const maxProfiles = 120;

// Members who finished onboarding, newest first.
async function getProfiles(supabase) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, avatar_path, created_at')
    .neq('first_name', '')
    .neq('last_name', '')
    .order('created_at', { ascending: false })
    .limit(maxProfiles);
  if (error) {
    console.error('Failed to load profiles from Supabase:', error.message);
    return [];
  }
  return data.map((profile) => ({
    ...profile,
    joined: new Date(profile.created_at).toLocaleDateString('en-US', { dateStyle: 'long' }),
    avatarUrl: profile.avatar_path
      ? supabase.storage.from('avatars').getPublicUrl(profile.avatar_path).data.publicUrl
      : null,
  }));
}

export default async function Home() {
  const { supabase, user } = await getUserAndProfile();
  const profiles = await getProfiles(supabase);
  const tiles = [...profiles, ...placeholderProfiles.slice(0, Math.max(0, boardSize - profiles.length))];
  return (
    <main className="board">
      <header className="board-header">
        <h1>People</h1>
        <nav>{user ? <Link href="/profile">Profile</Link> : <Link href="/login">Log in</Link>}</nav>
      </header>
      <Board profiles={tiles} userId={user?.id ?? null} />
    </main>
  );
}
