'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { isThemeId } from '../../lib/themes';

export async function uploadMedia(previousState, formData) {
  const { supabase, user } = await requireAdmin();
  const file = formData.get('image');
  const prompt = String(formData.get('prompt') ?? '').trim();
  const caption = String(formData.get('caption') ?? '').trim();
  const theme = String(formData.get('theme_id') ?? '');
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!(file instanceof File) || !types[file.type] || !file.size || file.size > 10485760) return { error: 'Choose a JPEG, PNG or WebP image of 10 MB or less.' };
  if (!prompt || prompt.length > 500 || caption.length > 300 || (theme && !isThemeId(theme))) return { error: 'Enter a prompt of up to 500 characters, a caption of up to 300, and a valid theme.' };
  const path = `${user.id}/${crypto.randomUUID()}.${types[file.type]}`;
  const bucket = supabase.storage.from('generations');
  const { error: uploadError } = await bucket.upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (uploadError) return { error: 'Could not upload the image.' };
  const { error } = await supabase.from('posts').insert({ prompt, caption: caption || null, model: 'uploaded', image_path: path,
    theme_id: theme ? Number(theme) : null, posted_at: formData.get('publish') === 'on' ? new Date().toISOString() : null });
  if (error) { await bucket.remove([path]); return { error: error.message }; }
  for (const route of ['/admin', '/posts', '/create', `/people/${user.id}`]) revalidatePath(route);
  return { message: 'Image uploaded.' };
}
