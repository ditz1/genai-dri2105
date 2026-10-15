'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { pickTheme } from '../../lib/themes';
import { isDay } from '../../lib/tournaments';
import { createClient } from '../../lib/supabase/server';

// Row level security already limits all of this to admins; checking first gives a clear answer instead of a silent no-op.
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (isAdmin !== true) notFound();
  return supabase;
}

function refresh(day) {
  revalidatePath('/admin');
  revalidatePath('/tournaments');
  revalidatePath('/create');
  if (day) revalidatePath(`/tournaments/${day}`);
}

// Runs one of the admin tournament functions in the database for the form's day.
async function runForDay(formData, name, args = {}) {
  const supabase = await requireAdmin();
  const day = String(formData.get('day') ?? '');
  if (!isDay(day)) return;
  const { error } = await supabase.rpc(name, { target_day: day, ...args });
  if (error) console.error(`Failed to run ${name}:`, error.message);
  refresh(day);
}

// Updates the day's theme if there is one, otherwise adds it.
async function writeTheme(supabase, day, { title, description, model }) {
  const values = { title, description, model, updated_at: new Date().toISOString() };
  const { data: changed, error } = await supabase.from('daily_themes').update(values).eq('day', day).select('day');
  if (error || changed.length) return error;
  return (await supabase.from('daily_themes').insert({ day, title, description, model })).error;
}

export async function saveTheme(previousState, formData) {
  const supabase = await requireAdmin();
  const day = String(formData.get('day') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  if (!isDay(day)) return { error: 'Pick a date.' };
  if (!title || title.length > 80) return { error: 'Themes need a title of 80 characters or fewer.' };
  if (description.length > 400) return { error: 'Descriptions must be 400 characters or fewer.' };
  const error = await writeTheme(supabase, day, { title, description, model: null });
  if (error) {
    console.error('Failed to save theme:', error.message);
    return { error: 'Could not save that theme.' };
  }
  refresh();
  return { message: `Saved the theme for ${day}.` };
}

export async function generateTheme(previousState, formData) {
  const supabase = await requireAdmin();
  const day = String(formData.get('day') ?? '');
  if (!isDay(day)) return { error: 'Pick a date.' };
  const theme = await pickTheme(supabase);
  const error = await writeTheme(supabase, day, theme);
  if (error) {
    console.error('Failed to save generated theme:', error.message);
    return { error: 'Could not save the new theme.' };
  }
  refresh();
  return { message: theme.model ? `Gemini suggested "${theme.title}".` : `Gemini didn't answer, so "${theme.title}" was picked from the built-in list.` };
}

export async function removeTheme(formData) {
  const supabase = await requireAdmin();
  const { error } = await supabase.from('daily_themes').delete().eq('day', String(formData.get('day') ?? ''));
  if (error) console.error('Failed to remove theme:', error.message);
  refresh();
}

export async function saveSettings(previousState, formData) {
  const supabase = await requireAdmin();
  const roundHours = Number(formData.get('round_hours'));
  const timezone = String(formData.get('timezone') ?? '').trim();
  if (!Number.isInteger(roundHours) || roundHours < 1 || roundHours > 168) return { error: 'Rounds must last between 1 and 168 hours.' };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return { error: `"${timezone}" is not a time zone. Use a name like America/New_York.` };
  }
  const { error } = await supabase
    .from('app_settings')
    .update({ round_hours: roundHours, timezone, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) {
    console.error('Failed to save settings:', error.message);
    return { error: 'Could not save the settings.' };
  }
  refresh();
  return { message: 'Settings saved.' };
}

export async function startTournament(formData) {
  await runForDay(formData, 'admin_start_tournament');
}

// Decides the current round now and opens the next one (or crowns the champion).
export async function endRound(formData) {
  await runForDay(formData, 'admin_close_round');
}

export async function pauseTournament(formData) {
  await runForDay(formData, 'admin_pause_tournament');
}

export async function resumeTournament(formData) {
  await runForDay(formData, 'admin_resume_tournament');
}

// Plays out every remaining round at once.
export async function finishTournament(formData) {
  await runForDay(formData, 'admin_finish_tournament');
}

export async function cancelTournament(formData) {
  await runForDay(formData, 'admin_cancel_tournament');
}

// Sets how long the current round has left, from now; 0 closes it within a minute.
export async function setTimeLeft(formData) {
  const hours = Number(formData.get('hours'));
  if (formData.get('hours') === '' || !Number.isFinite(hours) || hours < 0 || hours > 168) return;
  await runForDay(formData, 'admin_set_round_end', { ends_at: new Date(Date.now() + hours * 3600000).toISOString() });
}

// Decides a matchup in the current round for side a or b, or reopens it to voting when side is empty.
export async function setMatchWinner(formData) {
  const supabase = await requireAdmin();
  const side = String(formData.get('side') ?? '');
  const { error } = await supabase.rpc('admin_set_match_winner', {
    target_match: String(formData.get('match') ?? ''),
    side: side === 'a' || side === 'b' ? side : null,
  });
  if (error) console.error('Failed to set matchup winner:', error.message);
  refresh(String(formData.get('day') ?? ''));
}

// Throws away a bracket and its votes, then seeds it again from the day's posted images and their current scores.
export async function reseedTournament(formData) {
  const supabase = await requireAdmin();
  const day = String(formData.get('day') ?? '');
  const { error } = await supabase.from('tournaments').delete().eq('day', day);
  if (error) console.error('Failed to remove tournament:', error.message);
  else {
    const { error: startError } = await supabase.rpc('admin_start_tournament', { target_day: day });
    if (startError) console.error('Failed to restart tournament:', startError.message);
  }
  refresh(day);
}

export async function removePost(formData) {
  const supabase = await requireAdmin();
  const { data: removed, error } = await supabase
    .from('posts')
    .delete()
    .eq('id', String(formData.get('id') ?? ''))
    .select('image_path, user_id');
  if (error) console.error('Failed to delete post:', error.message);
  if (removed?.length) await supabase.storage.from('generations').remove(removed.map((post) => post.image_path));
  refresh();
  revalidatePath('/posts');
  removed?.forEach((post) => revalidatePath(`/people/${post.user_id}`));
}
