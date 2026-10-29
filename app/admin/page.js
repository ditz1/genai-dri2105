import Form from 'next/form';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getPosts } from '../../lib/posts';
import { countEntries, getOpenThemes, themeColumns, toTheme } from '../../lib/themes';
import { advanceTournaments, getTournaments, roundName } from '../../lib/tournaments';
import { getUserAndProfile } from '../../lib/supabase/server';
import Countdown from '../countdown';
import LocalTime from '../local-time';
import Header from '../header';
import { ThemeWindowControls, TournamentControls } from './controls';
import { NewThemeForm, PostEditor, SettingsForm, ThemeEditor } from './forms';
import CatalogSection from './catalog-section';
import { GenerationSettingsForm, SignupSettingsForm } from './catalog-forms';
import GenerationHistory from './generation-history';
import { NewSimulationForm, SimulationControl, UploadMediaForm } from './tools-forms';

export const metadata = { title: 'Admin', robots: { index: false, follow: false } };
// Generating an AI theme can take a few seconds.
export const maxDuration = 300;
const postsPerPage = 24;

function bracketStatus(tournament) {
  if (tournament.status === 'running') return <>{roundName(tournament.currentRound, tournament.rounds)}, ends in <Countdown until={tournament.roundEndsAt} /></>;
  if (tournament.status === 'paused') return `${roundName(tournament.currentRound, tournament.rounds)}, paused`;
  if (tournament.status === 'cancelled') return 'cancelled';
  return tournament.champion ? `won by ${tournament.champion.author}` : 'finished';
}

export default async function Admin({ searchParams }) {
  const { supabase, user, isAdmin } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!isAdmin) notFound();
  const params = await searchParams;
  const search = String(params.q ?? '').trim().slice(0, 100);
  const shown = Math.min(Math.max(Number.parseInt(params.posts, 10) || postsPerPage, postsPerPage), 240);
  const historyShown = Math.min(Math.max(Number.parseInt(params.history, 10) || 25, 25), 200);
  const kind = ['image', 'theme'].includes(params.kind) ? params.kind : '';
  const status = ['pending', 'succeeded', 'failed'].includes(params.status) ? params.status : '';
  let historyQuery = supabase.from('generation_requests').select('*,user:profiles!generation_requests_user_id_fkey(first_name,last_name),responses:llm_responses(output)')
    .order('created_at', { ascending: false }).limit(historyShown + 1);
  if (kind) historyQuery = historyQuery.eq('kind', kind);
  if (status) historyQuery = historyQuery.eq('status', status);
  await advanceTournaments(supabase);

  // Opens a theme if none is running, the same way visitors' pages do.
  await getOpenThemes(supabase);
  const [{ data: themeRows }, { data: settings }, tournaments, posts, { data: members, error: membersError },
    { data: providers }, { data: models }, { data: examples }, { data: domains }, { data: emails },
    { data: requests, error: historyError }, { data: simulations }] = await Promise.all([
    supabase.from('themes').select(themeColumns).order('opens_at', { ascending: false }).limit(80),
    supabase.from('app_settings').select('*').maybeSingle(),
    getTournaments(supabase, { includeCancelled: true }),
    // One extra to tell whether there are more to show.
    getPosts(supabase, user, { search, includeDrafts: true, limit: shown + 1 }),
    supabase.rpc('admin_list_members'),
    supabase.from('llm_providers').select('*').order('name'),
    supabase.from('llm_models').select('*').order('name'),
    supabase.from('ai_generation_examples').select('*').order('created_at', { ascending: false }),
    supabase.from('allowed_signup_domains').select('*').order('domain'),
    supabase.from('whitelisted_emails').select('*').order('email'),
    historyQuery,
    supabase.from('simulation_runs').select('*,theme:themes(title)').order('created_at', { ascending: false }).limit(20),
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
      <p className="meta">Manage the community, inspect AI activity and run test brackets.</p>
      <nav className="admin-jump-links" aria-label="Admin sections">
        {[['generation','Generation'],['history','Requests & responses'],['models','Models'],['providers','Providers'],['media','Media & prompts'],['examples','Examples'],['members','Members'],['signup','Signup access'],['simulations','Simulations']].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>
      {historyError && <p className="error">Admin data could not be loaded. Apply the admin observability migration and refresh.</p>}

      <dl className="stats">
        <div><dt>Members</dt><dd>{members?.length ?? '—'}</dd></div>
        <div><dt>Open themes</dt><dd>{open.length}</dd></div>
        <div><dt>Live brackets</dt><dd>{live.length}</dd></div>
        <div><dt>Champions</dt><dd>{tournaments.filter((tournament) => tournament.champion).length}</dd></div>
      </dl>

      <section id="generation" className="admin-section">
        <h2>Generation settings</h2>
        <p className="meta">New requests use the selected image and theme models. Instructions let you adjust prompt composition without introducing prompt chains.</p>
        {settings?.image_model_id && <GenerationSettingsForm settings={settings} models={models ?? []} providers={providers ?? []} />}
      </section>
      <GenerationHistory requests={requests ?? []} kind={kind} status={status} shown={historyShown}
        query={{ ...(search && { q: search }), ...(kind && { kind }), ...(status && { status }) }} />
      <CatalogSection kind="models" records={models ?? []} providers={providers ?? []} />
      <CatalogSection kind="providers" records={providers ?? []} />

      <h2>Open themes</h2>
      <p className="meta">
        Each theme is separate: it has its own entries and its own bracket, and changing one never touches another. When a
        theme's entries close, its bracket starts within a minute.
      </p>
      {open.length === 0 && <p>No theme is open. Open one below, or one opens automatically the next time someone visits.</p>}
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

      <h2 id="media">Media &amp; prompts</h2>
      <p className="meta">
        A post shows its caption, or its prompt when it has none. Saving a caption leaves the image, prompt, score and votes
        alone; clearing it shows the prompt again. All generated media is shown, including drafts. Deleting removes the image too.
      </p>
      <details className="admin-card"><summary>Upload an image</summary><UploadMediaForm themes={open} /></details>
      <Form action="/admin" scroll={false} className="controls search">
        <input type="search" name="q" defaultValue={search} maxLength={100} placeholder="Search prompts and captions" aria-label="Search prompts and captions" />
        <button className="secondary">Search</button>
        {search && <Link href="/admin" scroll={false}>Clear</Link>}
      </Form>
      {posts.length === 0 && <p>{search ? `No media prompts or captions contain "${search}".` : 'No media has been saved yet.'}</p>}
      <div className="posts">
        {posts.slice(0, shown).map((post) => <PostEditor key={post.id} post={post} />)}
      </div>
      {posts.length > shown && shown < 240 && (
        <p>
          <Link href={`/admin?${new URLSearchParams({ ...(search && { q: search }), posts: shown + postsPerPage })}`} scroll={false}>
            Show more posts
          </Link>
        </p>
      )}
      {posts.length > shown && shown >= 240 && <p className="meta">Showing the latest 240 matching images. Use search to narrow this view.</p>}

      <CatalogSection kind="examples" records={examples ?? []} />

      <section id="signup" className="admin-section">
        <h2>Signup access</h2>
        {settings && <SignupSettingsForm restricted={settings.restrict_signups} />}
        <CatalogSection kind="domains" records={domains ?? []} />
        <CatalogSection kind="emails" records={emails ?? []} />
      </section>

      <section id="simulations" className="admin-section">
        <h2>Test tournaments</h2>
        <p className="meta">Only accounts without a linked email can enter or cast simulated votes. Demo brackets have their own themes. Each round ends when you press its button.</p>
        <details className="admin-card"><summary>Create a demo tournament</summary><NewSimulationForm /></details>
        <div className="admin-cards">{(simulations ?? []).map((run) => <article className="admin-card" key={run.id}>
          <h3><Link href={`/tournaments/${run.theme_id}`}>{run.theme?.title}</Link></h3>
          <p className="meta">{run.participants.length} fake participants · <LocalTime value={run.created_at} /></p>
          <SimulationControl run={run} tournament={tournaments.find((t) => t.id === run.theme_id)} />
        </article>)}</div>
      </section>

      <h2 id="members">Members</h2>
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
                <td>{member.email || <span className="badge">demo · no email</span>}</td>
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
