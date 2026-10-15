import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getPosts } from '../../lib/posts';
import { formatDay, getToday } from '../../lib/themes';
import { advanceTournaments, countEntries, getTournaments, roundName } from '../../lib/tournaments';
import { getUserAndProfile } from '../../lib/supabase/server';
import Countdown from '../countdown';
import Header from '../header';
import { removePost, removeTheme, startTournament } from './actions';
import { TournamentControls } from './controls';
import { SettingsForm, ThemeForm } from './forms';

export const metadata = { title: 'Admin' };
// Asking Gemini for a theme can take a few seconds.
export const maxDuration = 30;

export default async function Admin() {
  const { supabase, user, isAdmin } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!isAdmin) notFound();
  await advanceTournaments(supabase);

  const today = await getToday(supabase);
  const [themes, { data: settings }, tournaments, posts, { data: members, error: membersError }, entries] = await Promise.all([
    supabase.from('daily_themes').select('day, title, description, model').order('day', { ascending: false }).limit(40),
    supabase.from('app_settings').select('timezone, round_hours').maybeSingle(),
    getTournaments(supabase, { includeCancelled: true }),
    getPosts(supabase, user, { limit: 24 }),
    supabase.rpc('admin_list_members'),
    countEntries(supabase, today.day),
  ]);
  if (membersError) console.error('Failed to list members:', membersError.message);
  const upcoming = (themes.data ?? []).filter((theme) => theme.day > today.day).reverse();
  const past = (themes.data ?? []).filter((theme) => theme.day < today.day).slice(0, 14);
  const todayStarted = tournaments.some((tournament) => tournament.day === today.day);
  const live = tournaments.filter((tournament) => tournament.status === 'running' || tournament.status === 'paused');
  const tomorrow = new Date(Date.parse(`${today.day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

  return (
    <main className="feed admin">
      <Header title="Admin" user={user} admin />

      <dl className="stats">
        <div><dt>Members</dt><dd>{members?.length ?? '—'}</dd></div>
        <div><dt>Entries today</dt><dd>{entries}</dd></div>
        <div><dt>Live brackets</dt><dd>{live.length}</dd></div>
        <div><dt>Champions</dt><dd>{tournaments.filter((tournament) => tournament.champion).length}</dd></div>
      </dl>

      <h2>Today's theme · {formatDay(today.day)}</h2>
      <ThemeForm theme={today.theme} day={today.day} fixedDay />

      <h2>Schedule a theme</h2>
      <p className="meta">Scheduled themes stay hidden until their day. Days without one get a theme from Gemini automatically.</p>
      <ThemeForm day={tomorrow} />
      {upcoming.length > 0 && (
        <ul className="admin-list">
          {upcoming.map((theme) => (
            <li key={theme.day}>
              <span><strong>{formatDay(theme.day)}</strong> {theme.title}{theme.description && ` — ${theme.description}`}</span>
              <form action={removeTheme}>
                <input type="hidden" name="day" value={theme.day} />
                <button className="secondary">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details>
          <summary>Past themes</summary>
          <ul className="admin-list">
            {past.map((theme) => (
              <li key={theme.day}>
                <span><strong>{formatDay(theme.day)}</strong> {theme.title} <span className="meta">({theme.model ?? 'written by an admin'})</span></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <h2>Brackets</h2>
      <p className="meta">
        Brackets start on their own at midnight and each round closes when its time is up. Ending a round decides its matchups
        (more votes wins, ties go to the higher seed) and opens the next one. To decide a single matchup by hand, open the bracket.
      </p>
      {!todayStarted && (
        <form className="admin-row" action={startTournament}>
          <input type="hidden" name="day" value={today.day} />
          <span>Today's bracket starts at midnight with {entries} {entries === 1 ? 'image' : 'images'} so far. Images posted after an early start won't join it.</span>
          <button className="secondary" disabled={entries === 0}>Start it now</button>
        </form>
      )}
      <form className="admin-row" action={startTournament}>
        <label className="inline">Start a bracket for another theme day <input type="date" name="day" max={today.day} required /></label>
        <button className="secondary">Start bracket</button>
      </form>
      {tournaments.length === 0 && <p>No brackets yet.</p>}
      <ul className="admin-list">
        {tournaments.map((tournament) => (
          <li key={tournament.day}>
            <span>
              <Link href={`/tournaments/${tournament.day}`}><strong>{formatDay(tournament.day)}</strong> {tournament.theme ?? 'Untitled theme'}</Link>
              <span className="meta">
                {' · '}{tournament.entryCount} images · {tournament.status === 'running'
                  ? <>{roundName(tournament.currentRound, tournament.rounds)}, ends in <Countdown until={tournament.roundEndsAt} /></>
                  : tournament.status === 'paused' ? `${roundName(tournament.currentRound, tournament.rounds)}, paused`
                  : tournament.status === 'cancelled' ? 'cancelled'
                  : tournament.champion ? `won by ${tournament.champion.author}` : 'finished'}
              </span>
            </span>
            <TournamentControls tournament={tournament} />
          </li>
        ))}
      </ul>

      <h2>Settings</h2>
      {settings && <SettingsForm settings={settings} />}

      <h2>Recent posts</h2>
      <div className="posts">
        {posts.map((post) => (
          <article className="post" key={post.id}>
            <img src={post.imageUrl} alt={post.prompt} loading="lazy" />
            <p className="prompt">{post.prompt}</p>
            <p className="meta">
              <Link href={`/people/${post.userId}`}>{post.author}</Link> · {post.date}{post.theme && ` · ${post.theme}`} · score {post.score}
            </p>
            <form action={removePost} className="votes">
              <input type="hidden" name="id" value={post.id} />
              <button className="secondary">Delete</button>
            </form>
          </article>
        ))}
      </div>

      <h2>Members</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Joined</th><th>Posts</th></tr>
          </thead>
          <tbody>
            {(members ?? []).map((member) => (
              <tr key={member.id}>
                <td>
                  <Link href={`/people/${member.id}`}>{`${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || 'No name yet'}</Link>
                  {member.is_admin && <span className="badge">admin</span>}
                </td>
                <td>{member.email}</td>
                <td>{new Date(member.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}</td>
                <td>{member.post_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
