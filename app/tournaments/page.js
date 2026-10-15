import Link from 'next/link';
import { getToday, formatDay } from '../../lib/themes';
import { advanceTournaments, countEntries, getTournaments, roundName } from '../../lib/tournaments';
import { getUserAndProfile } from '../../lib/supabase/server';
import Countdown from '../countdown';
import Header from '../header';
import ThemeBanner from '../theme-banner';

export const metadata = { title: 'Tournaments' };

function TournamentCard({ tournament }) {
  const { day, theme, status, champion, contenders, currentRound, rounds, roundEndsAt, entryCount } = tournament;
  return (
    <Link className="tournament-card" href={`/tournaments/${day}`}>
      {champion ? (
        <img src={champion.imageUrl} alt={champion.prompt} loading="lazy" />
      ) : contenders.length ? (
        <div className="preview">{contenders.map((entry) => <img key={entry.id} src={entry.imageUrl} alt={entry.prompt} loading="lazy" />)}</div>
      ) : (
        <div className="empty-image" />
      )}
      <p className="eyebrow">{formatDay(day)}</p>
      <h3>{theme ?? 'Untitled theme'}</h3>
      {status === 'running' ? (
        <p className="meta">
          {roundName(currentRound, rounds)} · {entryCount} images · ends in <Countdown until={roundEndsAt} />
        </p>
      ) : status === 'paused' ? (
        <p className="meta">{roundName(currentRound, rounds)} · {entryCount} images · paused</p>
      ) : (
        <p className="meta">{champion ? `Won by ${champion.author}` : 'No champion'} · {entryCount} {entryCount === 1 ? 'image' : 'images'}</p>
      )}
    </Link>
  );
}

export default async function Tournaments() {
  const { supabase, user } = await getUserAndProfile();
  await advanceTournaments(supabase);
  const [today, tournaments] = await Promise.all([getToday(supabase), getTournaments(supabase)]);
  const entries = await countEntries(supabase, today.day);
  const live = tournaments.filter((tournament) => tournament.status === 'running' || tournament.status === 'paused');
  const finished = tournaments.filter((tournament) => tournament.status === 'finished');
  return (
    <main className="feed">
      <Header title="Tournaments" />
      <ThemeBanner today={today} entries={entries}>
        <p><Link href="/create">Make an image for today's theme</Link></p>
      </ThemeBanner>

      <h2>Vote now</h2>
      {live.length === 0 && <p>No brackets are running right now. The next one starts at midnight with today's images.</p>}
      <div className="tournaments">
        {live.map((tournament) => <TournamentCard key={tournament.day} tournament={tournament} />)}
      </div>

      {finished.length > 0 && <h2>Champions</h2>}
      <div className="tournaments">
        {finished.map((tournament) => <TournamentCard key={tournament.day} tournament={tournament} />)}
      </div>
    </main>
  );
}
