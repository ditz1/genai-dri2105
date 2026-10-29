'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { catalogs, isUuid, readCatalogRecord } from '../../lib/admin-catalog';

export async function saveCatalogRecord(previousState, formData) {
  const { supabase } = await requireAdmin();
  const kind = String(formData.get('kind') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!Object.hasOwn(catalogs, kind) || (id && !isUuid(id))) return { error: 'That record could not be found.' };
  let error;
  if (formData.get('operation') === 'delete') {
    if (!id) return { error: 'Choose a record to delete.' };
    ({ error } = await supabase.from(catalogs[kind].table).delete().eq('id', id));
  } else {
    const record = readCatalogRecord(kind, formData);
    if (record.error) return record;
    ({ error } = id ? await supabase.from(record.catalog.table).update(record.values).eq('id', id)
      : await supabase.from(record.catalog.table).insert(record.values));
  }
  if (error) return { error: error.code === '23503' ? 'This record is in use. Choose another active model or remove its related models first.'
    : error.code === '23505' ? 'That record already exists.' : error.message };
  revalidatePath('/admin');
  return { message: formData.get('operation') === 'delete' ? 'Deleted.' : 'Saved.' };
}

export async function saveGenerationSettings(previousState, formData) {
  const { supabase } = await requireAdmin();
  const imageModel = String(formData.get('image_model_id') ?? '');
  const themeModel = String(formData.get('theme_model_id') ?? '');
  const prefix = String(formData.get('image_prompt_prefix') ?? '').trim();
  const instructions = String(formData.get('theme_instructions') ?? '').trim();
  if (!isUuid(imageModel) || !isUuid(themeModel) || prefix.length > 500 || instructions.length > 1000) return { error: 'Choose valid models and keep instructions within their limits.' };
  const { error } = await supabase.from('app_settings').update({ image_model_id: imageModel, theme_model_id: themeModel,
    image_prompt_prefix: prefix, theme_instructions: instructions, updated_at: new Date().toISOString() }).eq('id', true);
  if (error) return { error: error.message };
  revalidatePath('/admin');
  return { message: 'Generation settings saved. New requests use these models and instructions.' };
}

export async function saveSignupSettings(previousState, formData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('app_settings').update({ restrict_signups: formData.get('restrict_signups') === 'on' }).eq('id', true);
  if (error) return { error: error.message };
  revalidatePath('/admin');
  return { message: 'Signup settings saved.' };
}
