import { fallbackTheme, suggestTheme } from './gemini';
import { createAdminClient } from './supabase/admin';

const recentThemeCount = 30;

export const formatDay = (day, options = { dateStyle: 'medium' }) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

// Asks Gemini for a theme that differs from recent ones, falling back to a built-in list if it can't answer.
export async function pickTheme(supabase) {
  const { data: recent } = await supabase
    .from('daily_themes')
    .select('title')
    .order('day', { ascending: false })
    .limit(recentThemeCount);
  const recentTitles = (recent ?? []).map((theme) => theme.title);
  try {
    return await suggestTheme(recentTitles);
  } catch (error) {
    console.error('Failed to get a theme from Gemini:', error.message);
    return fallbackTheme(recentTitles);
  }
}

// Today's date in the app's time zone (from the database, so it matches when brackets close), the time zone,
// and today's theme. The theme is created the first time anyone asks for it; it is null only if it can't be saved.
export async function getToday(supabase) {
  if (!supabase) return { day: null, timezone: null, theme: null };
  const [{ data: day, error }, { data: settings }] = await Promise.all([
    supabase.rpc('current_theme_day'),
    supabase.from('app_settings').select('timezone, round_hours').maybeSingle(),
  ]);
  if (error) {
    console.error('Failed to load the theme day:', error.message);
    return { day: null, timezone: null, theme: null };
  }
  const today = { day, timezone: settings?.timezone ?? null, roundHours: settings?.round_hours ?? null };

  const { data: theme } = await supabase.from('daily_themes').select('day, title, description').eq('day', day).maybeSingle();
  if (theme) return { ...today, theme };

  const admin = createAdminClient();
  if (!admin) {
    console.error("Today's theme could not be created: SUPABASE_SECRET_KEY is not set.");
    return { ...today, theme: null };
  }
  const picked = await pickTheme(admin);
  // Two first visitors can race here; whichever insert lands first is the day's theme.
  const { error: insertError } = await admin
    .from('daily_themes')
    .upsert({ day, title: picked.title, description: picked.description, model: picked.model }, { onConflict: 'day', ignoreDuplicates: true });
  if (insertError) console.error("Failed to save today's theme:", insertError.message);
  const { data: saved } = await admin.from('daily_themes').select('day, title, description').eq('day', day).maybeSingle();
  return { ...today, theme: saved ?? null };
}

// Titles of the themes for the given days, as a map from day to title.
export async function getThemeTitles(supabase, days) {
  const unique = [...new Set(days.filter(Boolean))];
  if (!supabase || !unique.length) return {};
  const { data } = await supabase.from('daily_themes').select('day, title').in('day', unique);
  return Object.fromEntries((data ?? []).map((theme) => [theme.day, theme.title]));
}
