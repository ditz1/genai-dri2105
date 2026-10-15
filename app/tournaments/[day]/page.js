import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDay } from '../../../lib/themes';
import { advanceTournaments, getTournament, isDay, roundName } from '../../../lib/tournaments';
import { getUserAndProfile } from '../../../lib/supabase/server';
import { MatchControls, TournamentControls } from '../../admin/controls';
import Countdown from '../../countdown';
import Header from '../../header';
import Matchup from './matchup';

export async function generateMetadata({ params }) {
  const { day } = await params;
  return { title: isDay(day) ? `Tournament · ${formatDay(day)}` : 'Tournament' };
}

// One side of a matchup in the bracket: thumbnail, author and votes. Winners are highlighted once decided.
function BracketEntry({ entry, seed, votes, decided, won, round }) {
  if (!entry) {
    const label = decided === undefined ? 'TBD' : seed ? 'Removed' : round === 1 ? 'Bye' : '—';
    return <div className="bracket-entry empty">{label}</div>;
  }
  return (
    <div className={`bracket-entry${decided ? (won ? ' won' : ' lost') : ''}`}>
      <img src={entry.imageUrl} alt="" loading="lazy" />
      <span className="name">{entry.author}</span>
      {votes !== null && <span className="count">{votes}</span>}
    </div>
  );
}

function Bracket({ tournament }) {
  const rounds = Array.from({ length: tournament.rounds }, (_, index) => index + 1);
  return (
    <div className="bracket">
      {rounds.map((round) => {
        const slots = tournament.bracketSize / 2 ** round;
        const matches = tournament.matches.filter((match) => match.round === round);
        return (
          <section className="bracket-round" key={round}>
            <h3>{roundName(round, tournament.rounds)}</h3>
            <div className="bracket-slots">
            {Array.from({ length: slots }, (_, index) => {
              const match = matches.find((candidate) => candidate.slot === index + 1);
              if (!match) {
                return (
                  <div className="bracket-match" key={index}>
                    <BracketEntry round={round} />
                    <BracketEntry round={round} />
                  </div>
                );
              }
              const decided = Boolean(match.winnerId) || (match.round < tournament.currentRound);
              const bye = !match.a || !match.b;
              return (
                <div className="bracket-match" key={match.id}>
                  <BracketEntry entry={match.a} seed={match.seedA} votes={bye ? null : match.votesA} decided={decided} won={match.winnerId === match.a?.id} round={round} />
                  <BracketEntry entry={match.b} seed={match.seedB} votes={bye ? null : match.votesB} decided={decided} won={match.winnerId === match.b?.id} round={round} />
                </div>
              );
            })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default async function TournamentPage({ params }) {
  const { day } = await params;
  const { supabase, user, isAdmin } = await getUserAndProfile();
  if (!isDay(day)) notFound();
  await advanceTournaments(supabase);
  const tournament = await getTournament(supabase, user, day);
  if (!tournament || (tournament.status === 'cancelled' && !isAdmin)) notFound();

  const { champion, status, currentRound, rounds } = tournament;
  // Current-round matchups with two images, which an admin can decide or reopen.
  const manageable = status === 'running' || status === 'paused'
    ? tournament.matches.filter((match) => match.round === currentRound && match.a && match.b)
    : [];
  const open = status === 'running' ? tournament.matches.filter((match) => match.round === currentRound && match.a && match.b && !match.winnerId) : [];
  return (
    <main className="feed">
      <Header title={tournament.theme ?? 'Tournament'} user={user} admin={isAdmin} />
      <section className="theme">
        <p className="eyebrow">Theme for {formatDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {tournament.entryCount} {tournament.entryCount === 1 ? 'image' : 'images'}</p>
        <h2>{tournament.theme ?? 'Untitled theme'}</h2>
        {tournament.themeDescription && <p>{tournament.themeDescription}</p>}
        {status === 'running' && (
          <p className="meta">{roundName(currentRound, rounds)} · voting ends in <Countdown until={tournament.roundEndsAt} /></p>
        )}
        {status === 'paused' && <p className="meta">{roundName(currentRound, rounds)} · voting is paused for now.</p>}
        {status === 'cancelled' && <p className="meta">This bracket was cancelled. Only admins can see it.</p>}
      </section>

      {isAdmin && (
        <section className="admin-panel">
          <p className="eyebrow">Admin controls</p>
          <TournamentControls tournament={tournament} />
          {manageable.length > 0 && (
            <ul className="admin-list">
              {manageable.map((match) => (
                <li key={match.id}>
                  <span className="admin-match">
                    <BracketEntry entry={match.a} seed={match.seedA} votes={match.votesA} decided={Boolean(match.winnerId)} won={match.winnerId === match.a?.id} round={match.round} />
                    <BracketEntry entry={match.b} seed={match.seedB} votes={match.votesB} decided={Boolean(match.winnerId)} won={match.winnerId === match.b?.id} round={match.round} />
                  </span>
                  <MatchControls match={match} day={day} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {status === 'finished' && (
        <section className="champion">
          {champion ? (
            <>
              <img src={champion.imageUrl} alt={champion.prompt} />
              <div>
                <p className="eyebrow">Champion</p>
                <h2>{champion.prompt}</h2>
                <p className="meta">by <Link href={`/people/${champion.userId}`}>{champion.author}</Link></p>
                {tournament.entryCount === 1 && <p className="meta">The only image posted for this theme, so it won by default.</p>}
              </div>
            </>
          ) : (
            <p>The winning image has been removed.</p>
          )}
        </section>
      )}

      {open.length > 0 && (
        <>
          <h2>{roundName(currentRound, rounds)}: pick a winner in each matchup</h2>
          <div className="matchups">
            {open.map((match) => <Matchup key={match.id} match={match} signedIn={Boolean(user)} />)}
          </div>
        </>
      )}

      {rounds > 0 && (
        <>
          <h2>Bracket</h2>
          <Bracket tournament={tournament} />
        </>
      )}
      <p><Link href="/tournaments">All tournaments</Link></p>
    </main>
  );
}
