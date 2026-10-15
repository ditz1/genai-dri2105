import Link from 'next/link';
import { countEntries, getOpenThemes } from '../../lib/themes';
import { advanceTournaments, getTournaments, roundName } from '../../lib/tournaments';
import { getUserAndProfile } from '../../lib/supabase/server';
import Countdown from '../countdown';
import LocalTime from '../local-time';
import Header from '../header';
import ThemeBanner from '../theme-banner';

export const metadata = { title: 'Tournaments' };

function TournamentCard({ tournament }) {
  const { id, theme, status, champion, contenders, currentRound, rounds, roundEndsAt, entryCount, startedAt } = tournament;
  return (
    <Link className="tournament-card" href={`/tournaments/${id}`}>
      {champion ? (
        <img src={champion.imageUrl} alt={champion.prompt} loading="lazy" />
      ) : contenders.length ? (
        <div className="preview">{contenders.map((entry) => <img key={entry.id} src={entry.imageUrl} alt={entry.prompt} loading="lazy" />)}</div>
      ) : (
        <div className="empty-image" />
      )}
      <p className="eyebrow">Started <LocalTime value={startedAt} /></p>
      <h3>{theme?.title ?? 'Untitled theme'}</h3>
      {status === 'running' ? (
        <p className="meta">
          {roundName(currentRound, rounds)} · {entryCount} images · ends in <Countdown until={roundEndsAt} />
        </p>
      ) : status === 'paused' ? (
        <p className="meta">{roundName(currentRound, rounds)} · {entryCount} images · paused</p>
      ) : (
        <p className="meta">{champion ? `Champion by ${champion.author}` : 'No champion'} · {entryCount} {entryCount === 1 ? 'image' : 'images'}</p>
      )}
    </Link>
  );
}

export default async function Tournaments() {
  const { supabase } = await getUserAndProfile();
  await advanceTournaments(supabase);
  const [themes, tournaments] = await Promise.all([getOpenThemes(supabase), getTournaments(supabase)]);
  const entries = await countEntries(supabase, themes.map((theme) => theme.id));
  const live = tournaments.filter((tournament) => tournament.status === 'running' || tournament.status === 'paused');
  const finished = tournaments.filter((tournament) => tournament.status === 'finished');
  return (
    <main className="feed">
      <Header title="Tournaments" />
      {themes.length === 0 && <ThemeBanner />}
      {themes.map((theme) => (
        <ThemeBanner key={theme.id} theme={theme} entries={entries[theme.id] ?? 0}>
          <p><Link href={`/create?theme=${theme.id}`}>Make an image for this theme</Link></p>
        </ThemeBanner>
      ))}

      <h2>Vote now</h2>
      {live.length === 0 && <p>No brackets are running right now. The next one starts when an open theme's entries close.</p>}
      <div className="tournaments">
        {live.map((tournament) => <TournamentCard key={tournament.id} tournament={tournament} />)}
      </div>

      <h2>Past tournaments</h2>
      {finished.length === 0 && <p>No tournament has finished yet. Each one's champion shows up here.</p>}
      <div className="tournaments">
        {finished.map((tournament) => <TournamentCard key={tournament.id} tournament={tournament} />)}
      </div>
    </main>
  );
}
