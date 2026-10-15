import { fallbackTheme, suggestTheme } from './gemini';
import { createAdminClient } from './supabase/admin';

const recentThemeCount = 30;
export const themeColumns = 'id, title, description, model, opens_at, closes_at';

export const isThemeId = (value) => typeof value === 'string' && /^\d{1,12}$/.test(value);

export function toTheme(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    model: row.model ?? null,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
  };
}

// Asks Gemini for a theme that differs from recent ones, falling back to a built-in list if it can't answer.
export async function pickTheme(supabase) {
  const { data: recent } = await supabase
    .from('themes')
    .select('title')
    .order('opens_at', { ascending: false })
    .limit(recentThemeCount);
  const recentTitles = (recent ?? []).map((theme) => theme.title);
  try {
    return await suggestTheme(recentTitles);
  } catch (error) {
    console.error('Failed to get a theme from Gemini:', error.message);
    return fallbackTheme(recentTitles);
  }
}

async function loadOpenThemes(supabase) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('themes')
    .select(themeColumns)
    .lte('opens_at', now)
    .gt('closes_at', now)
    .order('opens_at', { ascending: false });
  if (error) console.error('Failed to load themes from Supabase:', error.message);
  return (data ?? []).map(toTheme);
}

// Themes taking entries right now, newest first. When none is open, one is opened from Gemini's suggestion with the
// default window from the settings, so there is always something to make images for.
export async function getOpenThemes(supabase) {
  if (!supabase) return [];
  const open = await loadOpenThemes(supabase);
  if (open.length) return open;

  const admin = createAdminClient();
  if (!admin) {
    console.error('No theme is open and none can be created: SUPABASE_SECRET_KEY is not set.');
    return [];
  }
  const picked = await pickTheme(admin);
  // The database opens it only if nobody else did in the meantime.
  const { error } = await admin.rpc('ensure_open_theme', { new_title: picked.title, new_description: picked.description, new_model: picked.model });
  if (error) console.error('Failed to open a new theme:', error.message);
  return loadOpenThemes(supabase);
}

// Posted images entered for each of the given themes so far, as a map from theme id to count.
export async function countEntries(supabase, themeIds) {
  if (!supabase || !themeIds.length) return {};
  const { data } = await supabase.from('posts').select('theme_id').in('theme_id', themeIds).not('posted_at', 'is', null);
  const counts = Object.fromEntries(themeIds.map((id) => [id, 0]));
  (data ?? []).forEach((post) => { counts[post.theme_id] += 1; });
  return counts;
}
