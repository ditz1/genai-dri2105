import { getThemeTitles } from './themes';

const entryColumns = 'id, user_id, prompt, image_path, author:profiles!posts_user_id_fkey(first_name, last_name)';

export const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

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

function toTournament(supabase, row, titles) {
  return {
    day: row.day,
    theme: titles[row.day] ?? null,
    status: row.status,
    bracketSize: row.bracket_size,
    entryCount: row.entry_count,
    currentRound: row.current_round,
    rounds: roundCount(row.bracket_size),
    roundEndsAt: row.round_ends_at,
    champion: toEntry(supabase, row.champion),
  };
}

// Starts brackets for finished theme days and closes rounds whose time is up. pg_cron does this every minute;
// calling it before showing brackets means a page never shows a round that should already be over.
export async function advanceTournaments(supabase) {
  if (!supabase) return;
  const { error } = await supabase.rpc('advance_tournaments');
  if (error) console.error('Failed to advance tournaments:', error.message);
}

// Posted images entered for a theme day so far.
export async function countEntries(supabase, day) {
  if (!supabase || !day) return 0;
  const { count } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('theme_day', day)
    .not('posted_at', 'is', null);
  return count ?? 0;
}

// Every bracket, newest theme day first. Cancelled ones are left out unless asked for.
export async function getTournaments(supabase, { limit = 60, includeCancelled = false } = {}) {
  if (!supabase) return [];
  let query = supabase
    .from('tournaments')
    .select(`day, status, bracket_size, entry_count, current_round, round_ends_at, champion:posts!tournaments_champion_post_id_fkey(${entryColumns})`)
    .order('day', { ascending: false })
    .limit(limit);
  if (!includeCancelled) query = query.neq('status', 'cancelled');
  const { data, error } = await query;
  if (error) {
    console.error('Failed to load tournaments from Supabase:', error.message);
    return [];
  }
  const running = data.filter((row) => row.status === 'running' || row.status === 'paused');
  const [titles, { data: matches }] = await Promise.all([
    getThemeTitles(supabase, data.map((row) => row.day)),
    running.length
      ? supabase
          .from('matches')
          .select(`tournament_day, round, a:posts!matches_post_a_fkey(${entryColumns}), b:posts!matches_post_b_fkey(${entryColumns})`)
          .in('tournament_day', running.map((row) => row.day))
          .order('slot')
      : { data: [] },
  ]);
  return data.map((row) => {
    const contenders = (matches ?? [])
      .filter((match) => match.tournament_day === row.day && match.round === row.current_round)
      .flatMap((match) => [match.a, match.b])
      .filter(Boolean)
      .slice(0, 4)
      .map((post) => toEntry(supabase, post));
    return { ...toTournament(supabase, row, titles), contenders };
  });
}

// One bracket with all of its matchups so far. Row level security returns only the viewer's own match votes.
export async function getTournament(supabase, user, day) {
  if (!supabase || !isDay(day)) return null;
  const { data: row, error } = await supabase
    .from('tournaments')
    .select(`day, status, bracket_size, entry_count, current_round, round_ends_at, champion:posts!tournaments_champion_post_id_fkey(${entryColumns})`)
    .eq('day', day)
    .maybeSingle();
  if (error) console.error('Failed to load tournament from Supabase:', error.message);
  if (!row) return null;

  const [titles, { data: themeRow }, { data: matches, error: matchError }] = await Promise.all([
    getThemeTitles(supabase, [day]),
    supabase.from('daily_themes').select('description').eq('day', day).maybeSingle(),
    supabase
      .from('matches')
      .select(`id, round, slot, seed_a, seed_b, votes_a, votes_b, winner_post_id, a:posts!matches_post_a_fkey(${entryColumns}), b:posts!matches_post_b_fkey(${entryColumns})${user ? ', match_votes(side)' : ''}`)
      .eq('tournament_day', day)
      .order('round')
      .order('slot'),
  ]);
  if (matchError) console.error('Failed to load matchups from Supabase:', matchError.message);

  return {
    ...toTournament(supabase, row, titles),
    themeDescription: themeRow?.description ?? '',
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
