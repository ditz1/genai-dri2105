'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '../lib/supabase/server';

const maxNameLength = 80;

function readNames(formData) {
  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  if (!firstName || !lastName) return { error: 'Enter both a first and a last name.' };
  if (firstName.length > maxNameLength || lastName.length > maxNameLength) return { error: 'Names must be 80 characters or fewer.' };
  return { firstName, lastName };
}

async function saveProfile(values) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  // Upsert so a user whose row is somehow missing still ends up with one.
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...values, updated_at: new Date().toISOString() });
  if (error) console.error('Failed to save profile:', error.message);
  return { supabase, user, error };
}

export async function completeOnboarding(previousState, formData) {
  const names = readNames(formData);
  if (names.error) return { error: names.error };
  const { error } = await saveProfile({ first_name: names.firstName, last_name: names.lastName });
  if (error) return { error: 'Could not save your name. Try again.' };
  revalidatePath('/');
  redirect('/profile');
}

// The photo itself is uploaded to Storage from the browser; only its path is saved here.
export async function updateProfile(previousState, formData) {
  const names = readNames(formData);
  if (names.error) return { error: names.error };
  const values = { first_name: names.firstName, last_name: names.lastName };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const avatarPath = String(formData.get('avatar_path') ?? '');
  let previousPath = null;
  if (avatarPath) {
    if (!avatarPath.startsWith(`${user.id}/`)) return { error: 'That photo could not be saved.' };
    const { data: current } = await supabase.from('profiles').select('avatar_path').eq('id', user.id).maybeSingle();
    previousPath = current?.avatar_path ?? null;
    values.avatar_path = avatarPath;
  }

  const { error } = await saveProfile(values);
  if (error) return { error: 'Could not save your profile. Try again.' };
  if (previousPath && previousPath !== avatarPath) await supabase.storage.from('avatars').remove([previousPath]);
  revalidatePath('/profile');
  revalidatePath('/');
  return { message: 'Profile saved.' };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
