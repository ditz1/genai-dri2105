// Server-side reads for design sheets. Also used by scripts/check-studio.mjs, so imports carry their extension.
import { isUuid, publicImageUrl } from './sheet.js';

const authorName = (profile) => `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'A member';

// The winning image of a finished tournament, as the `source` a sheet is grown from, or null if there isn't one.
export async function getChampionSource(supabase, themeId) {
  if (!supabase || !/^\d{1,12}$/.test(String(themeId))) return null;
  const { data, error } = await supabase
    .from('tournaments')
    .select(`theme_id, theme:themes!tournaments_theme_id_fkey(title, description),
      champion:posts!tournaments_champion_post_id_fkey(id, user_id, prompt, caption, model, image_path, author:profiles!posts_user_id_fkey(first_name, last_name))`)
    .eq('theme_id', themeId)
    .eq('status', 'finished')
    .maybeSingle();
  if (error) console.error('Failed to load tournament champion:', error.message);
  const champion = data?.champion;
  if (!champion) return null;
  return {
    themeId: data.theme_id,
    themeTitle: data.theme?.title ?? 'Untitled theme',
    themeDescription: data.theme?.description ?? '',
    postId: champion.id,
    authorId: champion.user_id,
    author: authorName(champion.author),
    prompt: champion.prompt,
    caption: champion.caption ?? null,
    model: champion.model,
    imagePath: champion.image_path,
  };
}

// The member's sheets, most recently edited first, with what the list needs to show each one.
export async function getSheets(supabase, user) {
  if (!supabase || !user) return [];
  const { data, error } = await supabase
    .from('design_sheets')
    .select('id, title, summary, updated_at, theme_id, source:data->source')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('Failed to load design sheets:', error.message);
    return [];
  }
  return data.map((sheet) => {
    const cover = sheet.summary?.cover ?? sheet.source?.imagePath ?? null;
    return {
      id: sheet.id,
      title: sheet.title || 'Untitled',
      updatedAt: sheet.updated_at,
      themeId: sheet.theme_id,
      themeTitle: sheet.source?.themeTitle ?? null,
      coverUrl: cover ? publicImageUrl(cover) : null,
      renders: sheet.summary?.renders ?? 0,
      portions: sheet.summary?.portions ?? 0,
    };
  });
}

// One of the member's sheets with its whole document, or null.
export async function getSheet(supabase, user, id) {
  if (!supabase || !user || !isUuid(id)) return null;
  const { data, error } = await supabase.from('design_sheets').select('id, data').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (error) console.error('Failed to load design sheet:', error.message);
  return data ?? null;
}
