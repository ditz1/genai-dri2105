import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LIMITS } from '../../lib/studio/sheet';
import { getSheets } from '../../lib/studio/sheets';
import { getUserAndProfile, hasName } from '../../lib/supabase/server';
import { advanceTournaments, getTournaments } from '../../lib/tournaments';
import Header from '../header';
import LocalTime from '../local-time';
import { createSheet, deleteSheet } from './actions';

export const metadata = { title: 'Studio' };

const errors = {
  winner: "That tournament doesn't have a winning image to start from.",
  limit: `You can keep up to ${LIMITS.sheets} design sheets. Delete one to start another.`,
  create: 'Could not start that design sheet. Try again.',
};

export default async function StudioHome({ searchParams }) {
  const { supabase, user, profile } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!hasName(profile)) redirect('/onboarding');
  const { error } = await searchParams;
  await advanceTournaments(supabase);
  const [sheets, tournaments] = await Promise.all([getSheets(supabase, user), getTournaments(supabase)]);
  const winners = tournaments.filter((tournament) => tournament.status === 'finished' && tournament.champion);
  // A winner the member has already started from links to that sheet as well as offering a fresh one.
  const started = new Map(sheets.filter((sheet) => sheet.themeId).reverse().map((sheet) => [sheet.themeId, sheet.id]));

  return (
    <main className="feed">
      <Header title="Studio" />
      <section className="theme">
        <p className="eyebrow">Design sheets</p>
        <h2>Grow a tournament winner into a world</h2>
        <p>
          Pick any winning image. The studio reads its style, takes its colors, imagines the world around it, and runs a
          prompt chain that designs and renders a full sheet in that look: a character, an environment, a landmark, a
          creature and a signature item. Every prompt and every result along the way is yours to edit.
        </p>
      </section>
      {Object.hasOwn(errors, error) && <p className="error" role="alert">{errors[error]}</p>}

      {sheets.length > 0 && (
        <>
          <h2>Your design sheets</h2>
          <div className="posts">
            {sheets.map((sheet) => (
              <article className="post" key={sheet.id}>
                <Link href={`/studio/${sheet.id}`}>
                  {sheet.coverUrl ? <img src={sheet.coverUrl} alt="" loading="lazy" /> : <div className="empty-image" />}
                </Link>
                <p className="prompt"><Link href={`/studio/${sheet.id}`}>{sheet.title}</Link></p>
                <p className="meta">
                  {sheet.themeTitle ? `From the winner of ${sheet.themeTitle}` : 'Started from scratch'} · {sheet.renders} of {sheet.portions} rendered
                </p>
                <p className="meta">Edited <LocalTime value={sheet.updatedAt} /></p>
                <div className="votes">
                  <Link href={`/studio/${sheet.id}`}>Open</Link>
                  <form action={deleteSheet}>
                    <input type="hidden" name="id" value={sheet.id} />
                    <button className="secondary">Delete</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <h2>Start from a winner</h2>
      {winners.length === 0 && <p>No tournament has a winner yet. Once a bracket finishes, its champion shows up here.</p>}
      <div className="posts">
        {winners.map(({ id, theme, champion }) => (
          <article className="post" key={id}>
            <img src={champion.imageUrl} alt={champion.prompt} loading="lazy" />
            <p className="eyebrow">Winner of <Link href={`/tournaments/${id}`}>{theme?.title ?? 'Untitled theme'}</Link></p>
            <p className="prompt">{champion.description}</p>
            <p className="meta">by <Link href={`/people/${champion.userId}`}>{champion.author}</Link></p>
            <form className="votes" action={createSheet}>
              <input type="hidden" name="theme_id" value={id} />
              <button>{started.has(id) ? 'Start another sheet' : 'Start a design sheet'}</button>
              {started.has(id) && <Link href={`/studio/${started.get(id)}`}>Open yours</Link>}
            </form>
          </article>
        ))}
      </div>

      <h2>Or start from scratch</h2>
      <form className="prompt-form" action={createSheet}>
        <p className="meta">A blank sheet with a starter set of portions, where you write the world brief and pick the palette and style yourself.</p>
        <button className="secondary">Start a blank sheet</button>
      </form>
    </main>
  );
}
