import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getPosts } from '../../lib/posts';
import { countEntries, getOpenThemes, themeColumns, toTheme } from '../../lib/themes';
import { advanceTournaments, getTournaments, roundName } from '../../lib/tournaments';
import { getUserAndProfile } from '../../lib/supabase/server';
import Countdown from '../countdown';
import LocalTime from '../local-time';
import Header from '../header';
import { removePost } from './actions';
import { ThemeWindowControls, TournamentControls } from './controls';
import { NewThemeForm, SettingsForm, ThemeEditor } from './forms';

export const metadata = { title: 'Admin' };
// Asking Gemini for a theme can take a few seconds.
export const maxDuration = 30;

function bracketStatus(tournament) {
  if (tournament.status === 'running') return <>{roundName(tournament.currentRound, tournament.rounds)}, ends in <Countdown until={tournament.roundEndsAt} /></>;
  if (tournament.status === 'paused') return `${roundName(tournament.currentRound, tournament.rounds)}, paused`;
  if (tournament.status === 'cancelled') return 'cancelled';
  return tournament.champion ? `won by ${tournament.champion.author}` : 'finished';
}

export default async function Admin() {
  const { supabase, user, isAdmin } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!isAdmin) notFound();
  await advanceTournaments(supabase);

  // Opens a theme if none is running, the same way visitors' pages do.
  await getOpenThemes(supabase);
  const [{ data: themeRows }, { data: settings }, tournaments, posts, { data: members, error: membersError }] = await Promise.all([
    supabase.from('themes').select(themeColumns).order('opens_at', { ascending: false }).limit(80),
    supabase.from('app_settings').select('round_hours, theme_hours').maybeSingle(),
    getTournaments(supabase, { includeCancelled: true }),
    getPosts(supabase, user, { limit: 24 }),
    supabase.rpc('admin_list_members'),
  ]);
  if (membersError) console.error('Failed to list members:', membersError.message);

  const now = Date.now();
  const themes = (themeRows ?? []).map(toTheme);
  const open = themes.filter((theme) => Date.parse(theme.opensAt) <= now && Date.parse(theme.closesAt) > now);
  const upcoming = themes.filter((theme) => Date.parse(theme.opensAt) > now).reverse();
  const bracketed = new Set(tournaments.map((tournament) => tournament.id));
  const closed = themes.filter((theme) => Date.parse(theme.closesAt) <= now);
  const entries = await countEntries(supabase, [...open, ...closed.filter((theme) => !bracketed.has(theme.id))].map((theme) => theme.id));
  const live = tournaments.filter((tournament) => tournament.status === 'running' || tournament.status === 'paused');

  return (
    <main className="feed admin">
      <Header title="Admin" />

      <dl className="stats">
        <div><dt>Members</dt><dd>{members?.length ?? '—'}</dd></div>
        <div><dt>Open themes</dt><dd>{open.length}</dd></div>
        <div><dt>Live brackets</dt><dd>{live.length}</dd></div>
        <div><dt>Champions</dt><dd>{tournaments.filter((tournament) => tournament.champion).length}</dd></div>
      </dl>

      <h2>Open themes</h2>
      <p className="meta">
        Each theme is separate: it has its own entries and its own bracket, and changing one never touches another. When a
        theme's entries close, its bracket starts within a minute.
      </p>
      {open.length === 0 && <p>No theme is open. Open one below, or one opens from Gemini the next time someone visits.</p>}
      <div className="admin-cards">
        {open.map((theme) => (
          <article className="admin-card" key={theme.id}>
            <p className="eyebrow">
              {entries[theme.id] ?? 0} {entries[theme.id] === 1 ? 'entry' : 'entries'} · entries close in <Countdown until={theme.closesAt} /> · {theme.model ?? 'written by an admin'}
            </p>
            <ThemeEditor theme={theme} />
            <ThemeWindowControls theme={theme} />
          </article>
        ))}
      </div>

      <h2>Start a new theme</h2>
      <p className="meta">It runs alongside any open themes. Members pick which theme an image is for when more than one is open.</p>
      <NewThemeForm themeHours={settings?.theme_hours ?? 24} />

      {upcoming.length > 0 && (
        <>
          <h2>Scheduled themes</h2>
          <div className="admin-cards">
            {upcoming.map((theme) => (
              <article className="admin-card" key={theme.id}>
                <p className="eyebrow">Opens in <Countdown until={theme.opensAt} /> · closes <LocalTime value={theme.closesAt} /></p>
                <ThemeEditor theme={theme} />
                <ThemeWindowControls theme={theme} upcoming />
              </article>
            ))}
          </div>
        </>
      )}

      <h2>Brackets</h2>
      <p className="meta">
        Each round closes when its time is up. Ending a round decides its matchups (more votes wins, ties go to the higher seed)
        and opens the next one. To decide a single matchup by hand, open the bracket.
      </p>
      {tournaments.length === 0 && <p>No brackets yet.</p>}
      <ul className="admin-list">
        {tournaments.map((tournament) => (
          <li key={tournament.id}>
            <span>
              <Link href={`/tournaments/${tournament.id}`}><strong>{tournament.theme?.title ?? 'Untitled theme'}</strong></Link>
              <span className="meta"> · started <LocalTime value={tournament.startedAt} /> · {tournament.entryCount} images · {bracketStatus(tournament)}</span>
            </span>
            <TournamentControls tournament={tournament} />
          </li>
        ))}
      </ul>

      {closed.length > 0 && (
        <details>
          <summary>Past themes</summary>
          <ul className="admin-list">
            {closed.map((theme) => (
              <li key={theme.id}>
                <span>
                  <strong>{theme.title}</strong>
                  <span className="meta">
                    {' · '}<LocalTime value={theme.opensAt} /> to <LocalTime value={theme.closesAt} /> · {theme.model ?? 'written by an admin'} · {bracketed.has(theme.id)
                      ? <Link href={`/tournaments/${theme.id}`}>bracket</Link>
                      : entries[theme.id] ? 'bracket starting…' : 'no entries'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

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
