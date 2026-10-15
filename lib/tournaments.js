import { isThemeId, toTheme } from './themes';

const entryColumns = 'id, user_id, prompt, image_path, author:profiles!posts_user_id_fkey(first_name, last_name)';
const tournamentColumns = `theme_id, status, bracket_size, entry_count, current_round, round_ends_at, started_at,
  theme:themes!tournaments_theme_id_fkey(id, title, description, model, opens_at, closes_at),
  champion:posts!tournaments_champion_post_id_fkey(${entryColumns})`;

// A bracket of 8 has 3 rounds; a one-entry "bracket" has none.
export const roundCount = (bracketSize) => Math.round(Math.log2(Math.max(1, bracketSize)));

export function roundName(round, rounds) {
  if (round === rounds) return 'Final';
  if (round === rounds - 1) return 'Semifinals';
  if (round === rounds - 2) return 'Quarterfinals';
  return `Round ${round}`;
}

function toEntry(supabase, post) {
  if (!post) return null;
  return {
    id: post.id,
    userId: post.user_id,
    prompt: post.prompt,
    author: `${post.author?.first_name ?? ''} ${post.author?.last_name ?? ''}`.trim() || 'A member',
    imageUrl: supabase.storage.from('generations').getPublicUrl(post.image_path).data.publicUrl,
  };
}

// A tournament is identified by its theme's id, which is also its address: /tournaments/<id>.
function toTournament(supabase, row) {
  return {
    id: row.theme_id,
    theme: toTheme(row.theme),
    status: row.status,
    bracketSize: row.bracket_size,
    entryCount: row.entry_count,
    currentRound: row.current_round,
    rounds: roundCount(row.bracket_size),
    roundEndsAt: row.round_ends_at,
    startedAt: row.started_at,
    champion: toEntry(supabase, row.champion),
  };
}

// Starts brackets for themes whose entries have closed and closes rounds whose time is up. pg_cron does this every
// minute; calling it before showing brackets means a page never shows a round that should already be over.
export async function advanceTournaments(supabase) {
  if (!supabase) return;
  const { error } = await supabase.rpc('advance_tournaments');
  if (error) console.error('Failed to advance tournaments:', error.message);
}

// Every bracket, most recently started first. Cancelled ones are left out unless asked for.
export async function getTournaments(supabase, { limit = 60, includeCancelled = false } = {}) {
  if (!supabase) return [];
  let query = supabase.from('tournaments').select(tournamentColumns).order('started_at', { ascending: false }).limit(limit);
  if (!includeCancelled) query = query.neq('status', 'cancelled');
  const { data, error } = await query;
  if (error) {
    console.error('Failed to load tournaments from Supabase:', error.message);
    return [];
  }
  // Live brackets preview the images still in their current round.
  const running = data.filter((row) => row.status === 'running' || row.status === 'paused');
  const { data: matches } = running.length
    ? await supabase
        .from('matches')
        .select(`theme_id, round, a:posts!matches_post_a_fkey(${entryColumns}), b:posts!matches_post_b_fkey(${entryColumns})`)
        .in('theme_id', running.map((row) => row.theme_id))
        .order('slot')
    : { data: [] };
  return data.map((row) => {
    const contenders = (matches ?? [])
      .filter((match) => match.theme_id === row.theme_id && match.round === row.current_round)
      .flatMap((match) => [match.a, match.b])
      .filter(Boolean)
      .slice(0, 4)
      .map((post) => toEntry(supabase, post));
    return { ...toTournament(supabase, row), contenders };
  });
}

// One bracket with all of its matchups so far. Row level security returns only the viewer's own match votes.
export async function getTournament(supabase, user, id) {
  if (!supabase || !isThemeId(id)) return null;
  const [{ data: row, error }, { data: matches, error: matchError }] = await Promise.all([
    supabase.from('tournaments').select(tournamentColumns).eq('theme_id', id).maybeSingle(),
    supabase
      .from('matches')
      .select(`id, round, slot, seed_a, seed_b, votes_a, votes_b, winner_post_id, a:posts!matches_post_a_fkey(${entryColumns}), b:posts!matches_post_b_fkey(${entryColumns})${user ? ', match_votes(side)' : ''}`)
      .eq('theme_id', id)
      .order('round')
      .order('slot'),
  ]);
  if (error) console.error('Failed to load tournament from Supabase:', error.message);
  if (matchError) console.error('Failed to load matchups from Supabase:', matchError.message);
  if (!row) return null;

  return {
    ...toTournament(supabase, row),
    matches: (matches ?? []).map((match) => ({
      id: match.id,
      round: match.round,
      slot: match.slot,
      a: toEntry(supabase, match.a),
      b: toEntry(supabase, match.b),
      seedA: match.seed_a,
      seedB: match.seed_b,
      votesA: match.votes_a,
      votesB: match.votes_b,
      winnerId: match.winner_post_id,
      myVote: match.match_votes?.[0]?.side ?? null,
    })),
  };
}
