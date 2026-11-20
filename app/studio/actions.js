'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { newProject } from '../../lib/studio/chain';
import { isUuid, LIMITS, sheetFolder, summarize } from '../../lib/studio/sheet';
import { getChampionSource } from '../../lib/studio/sheets';
import { createClient } from '../../lib/supabase/server';

// Starts a design sheet. With a theme id, it grows from that finished tournament's winning image: the sheet takes
// its title from the theme and remembers the image, its prompt and who made it. Without one, it starts blank.
export async function createSheet(formData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const themeId = String(formData.get('theme_id') ?? '');
  let source = null;
  if (themeId) {
    source = await getChampionSource(supabase, themeId);
    if (!source) redirect('/studio?error=winner');
  }
  const { count } = await supabase.from('design_sheets').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if (count >= LIMITS.sheets) redirect('/studio?error=limit');

  const data = newProject(source);
  const { data: sheet, error } = await supabase
    .from('design_sheets')
    .insert({ title: data.title, data, summary: summarize(data), source_post_id: source?.postId ?? null, theme_id: source?.themeId ?? null })
    .select('id')
    .single();
  if (error) {
    console.error('Failed to create design sheet:', error.message);
    redirect('/studio?error=create');
  }
  revalidatePath('/studio');
  redirect(`/studio/${sheet.id}`);
}

// Deletes one of the member's sheets along with every image rendered for it.
export async function deleteSheet(formData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const id = String(formData.get('id') ?? '');
  if (isUuid(id)) {
    const { data: removed, error } = await supabase.from('design_sheets').delete().eq('id', id).eq('user_id', user.id).select('id');
    if (error) console.error('Failed to delete design sheet:', error.message);
    if (removed?.length) {
      const folder = sheetFolder(user.id, id);
      const generations = supabase.storage.from('generations');
      const { data: files } = await generations.list(folder, { limit: 1000 });
      if (files?.length) await generations.remove(files.map((file) => `${folder}/${file.name}`));
    }
  }
  revalidatePath('/studio');
  redirect('/studio');
}
