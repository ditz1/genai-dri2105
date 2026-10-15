'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { isThemeId, pickTheme } from '../../lib/themes';
import { createClient } from '../../lib/supabase/server';

const hour = 3600000;

// Row level security already limits all of this to admins; checking first gives a clear answer instead of a silent no-op.
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (isAdmin !== true) notFound();
  return supabase;
}

function refresh(themeId) {
  revalidatePath('/admin');
  revalidatePath('/tournaments');
  revalidatePath('/create');
  if (themeId) revalidatePath(`/tournaments/${themeId}`);
}

const readThemeId = (formData) => {
  const value = String(formData.get('theme') ?? '');
  return isThemeId(value) ? Number(value) : null;
};

// A number of hours from a form field, within limits; `fallback` when the field is empty.
function readHours(formData, name, { min, max, fallback }) {
  const raw = String(formData.get(name) ?? '').trim();
  if (raw === '') return fallback;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours >= min && hours <= max ? hours : undefined;
}

function readWording(formData) {
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  if (!title || title.length > 80) return { error: 'Themes need a title of 80 characters or fewer.' };
  if (description.length > 400) return { error: 'Descriptions must be 400 characters or fewer.' };
  return { title, description };
}

// Opens a new theme alongside any others, now or after a delay, taking entries for the given number of hours.
async function openTheme(supabase, formData, wording) {
  const { data: settings } = await supabase.from('app_settings').select('theme_hours').maybeSingle();
  const startsIn = readHours(formData, 'starts_in', { min: 0, max: 720, fallback: 0 });
  const lasts = readHours(formData, 'hours', { min: 0.25, max: 720, fallback: settings?.theme_hours ?? 24 });
  if (startsIn === undefined) return { error: 'Start it between 0 and 720 hours from now.' };
  if (lasts === undefined) return { error: 'Entries must stay open between 15 minutes and 720 hours.' };
  const opensAt = Date.now() + startsIn * hour;
  const { error } = await supabase.from('themes').insert({
    ...wording,
    opens_at: new Date(opensAt).toISOString(),
    closes_at: new Date(opensAt + lasts * hour).toISOString(),
  });
  if (error) {
    console.error('Failed to create theme:', error.message);
    return { error: 'Could not create that theme.' };
  }
  refresh();
  const when = startsIn ? `opens in ${startsIn} ${startsIn === 1 ? 'hour' : 'hours'}` : 'is open now';
  return { message: `"${wording.title}" ${when} and takes entries for ${lasts} ${lasts === 1 ? 'hour' : 'hours'}.` };
}

export async function createTheme(previousState, formData) {
  const supabase = await requireAdmin();
  const wording = readWording(formData);
  if (wording.error) return wording;
  return openTheme(supabase, formData, { ...wording, model: null });
}

export async function createGeminiTheme(previousState, formData) {
  const supabase = await requireAdmin();
  const picked = await pickTheme(supabase);
  const result = await openTheme(supabase, formData, picked);
  if (result.error || picked.model) return result;
  return { message: `Gemini didn't answer, so ${result.message} (picked from the built-in list)` };
}

// Rewords one theme. Other themes, and the brackets that belong to them, are untouched.
export async function updateTheme(previousState, formData) {
  const supabase = await requireAdmin();
  const themeId = readThemeId(formData);
  const wording = readWording(formData);
  if (!themeId) return { error: 'That theme could not be found.' };
  if (wording.error) return wording;
  const { error } = await supabase
    .from('themes')
    .update({ ...wording, model: null, updated_at: new Date().toISOString() })
    .eq('id', themeId);
  if (error) {
    console.error('Failed to update theme:', error.message);
    return { error: 'Could not save that theme.' };
  }
  refresh(themeId);
  return { message: 'Saved.' };
}

// Sets how much longer an open theme takes entries. Its bracket starts within a minute of entries closing.
export async function setEntriesLeft(formData) {
  const supabase = await requireAdmin();
  const themeId = readThemeId(formData);
  const hours = readHours(formData, 'hours', { min: 0, max: 720, fallback: undefined });
  if (!themeId || hours === undefined) return;
  const { data: theme } = await supabase.from('themes').select('opens_at').eq('id', themeId).maybeSingle();
  if (!theme) return;
  const closesAt = Math.max(Date.now() + hours * hour, Date.parse(theme.opens_at) + 1000);
  const { error } = await supabase.from('themes').update({ closes_at: new Date(closesAt).toISOString() }).eq('id', themeId);
  if (error) console.error('Failed to change theme window:', error.message);
  refresh(themeId);
}

// Removes a theme that hasn't opened yet.
export async function removeTheme(formData) {
  const supabase = await requireAdmin();
  const themeId = readThemeId(formData);
  if (!themeId) return;
  const { error } = await supabase.from('themes').delete().eq('id', themeId).gt('opens_at', new Date().toISOString());
  if (error) console.error('Failed to remove theme:', error.message);
  refresh();
}

export async function saveSettings(previousState, formData) {
  const supabase = await requireAdmin();
  const roundHours = Number(formData.get('round_hours'));
  const themeHours = Number(formData.get('theme_hours'));
  if (!Number.isInteger(roundHours) || roundHours < 1 || roundHours > 168) return { error: 'Rounds must last between 1 and 168 hours.' };
  if (!Number.isInteger(themeHours) || themeHours < 1 || themeHours > 720) return { error: 'Themes must take entries for between 1 and 720 hours.' };
  const { error } = await supabase
    .from('app_settings')
    .update({ round_hours: roundHours, theme_hours: themeHours, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) {
    console.error('Failed to save settings:', error.message);
    return { error: 'Could not save the settings.' };
  }
  refresh();
  return { message: 'Settings saved.' };
}

// Runs one of the admin tournament functions in the database for the form's theme.
async function runForTheme(formData, name, args = {}) {
  const supabase = await requireAdmin();
  const themeId = readThemeId(formData);
  if (!themeId) return;
  const { error } = await supabase.rpc(name, { target_theme: themeId, ...args });
  if (error) console.error(`Failed to run ${name}:`, error.message);
  refresh(themeId);
}

// Closes the theme's entries now and seeds its bracket.
export async function startTournament(formData) {
  await runForTheme(formData, 'admin_start_tournament');
}

// Decides the current round now and opens the next one (or crowns the champion).
export async function endRound(formData) {
  await runForTheme(formData, 'admin_close_round');
}

export async function pauseTournament(formData) {
  await runForTheme(formData, 'admin_pause_tournament');
}

export async function resumeTournament(formData) {
  await runForTheme(formData, 'admin_resume_tournament');
}

// Plays out every remaining round at once.
export async function finishTournament(formData) {
  await runForTheme(formData, 'admin_finish_tournament');
}

export async function cancelTournament(formData) {
  await runForTheme(formData, 'admin_cancel_tournament');
}

// Sets how long the current round has left, from now; 0 closes it within a minute.
export async function setTimeLeft(formData) {
  const hours = readHours(formData, 'hours', { min: 0, max: 168, fallback: undefined });
  if (hours === undefined) return;
  await runForTheme(formData, 'admin_set_round_end', { ends_at: new Date(Date.now() + hours * hour).toISOString() });
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
  refresh(readThemeId(formData));
}

// Throws away a bracket and its votes, then seeds it again from the theme's posted images and their current scores.
export async function reseedTournament(formData) {
  const supabase = await requireAdmin();
  const themeId = readThemeId(formData);
  if (!themeId) return;
  const { error } = await supabase.from('tournaments').delete().eq('theme_id', themeId);
  if (error) console.error('Failed to remove tournament:', error.message);
  else {
    const { error: startError } = await supabase.rpc('admin_start_tournament', { target_theme: themeId });
    if (startError) console.error('Failed to restart tournament:', startError.message);
  }
  refresh(themeId);
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
