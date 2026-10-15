'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { generateImage, imageModel } from '../lib/generate';
import { createClient } from '../lib/supabase/server';

const maxNameLength = 80;
const maxPromptLength = 500;
// Image generation runs on a free daily allowance shared by everyone, so each member gets a slice of it.
const dailyGenerations = 10;

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

// Generates an image from the prompt and saves it, with the prompt and model, as a draft post.
export async function generatePost(previousState, formData) {
  const prompt = String(formData.get('prompt') ?? '').trim();
  if (!prompt) return { error: 'Describe the image you want.' };
  if (prompt.length > maxPromptLength) return { error: `Prompts must be ${maxPromptLength} characters or fewer.`, prompt };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since);
  if (count >= dailyGenerations) return { error: `You can generate ${dailyGenerations} images a day. Try again tomorrow.`, prompt };

  let image;
  try {
    image = await generateImage(prompt);
  } catch (error) {
    console.error('Failed to generate image:', error.message);
    return { error: 'Could not generate that image. Try again.', prompt };
  }

  const path = `${user.id}/${crypto.randomUUID()}.${image.extension}`;
  const generations = supabase.storage.from('generations');
  const { error: uploadError } = await generations.upload(path, image.bytes, { contentType: image.contentType });
  if (uploadError) {
    console.error('Failed to store generated image:', uploadError.message);
    return { error: 'Could not save that image. Try again.', prompt };
  }
  const { error } = await supabase.from('posts').insert({ prompt, model: imageModel, image_path: path });
  if (error) {
    console.error('Failed to save post:', error.message);
    await generations.remove([path]);
    return { error: 'Could not save that image. Try again.', prompt };
  }
  revalidatePath('/create');
  return {};
}

export async function publishPost(formData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { error } = await supabase
    .from('posts')
    .update({ posted_at: new Date().toISOString() })
    .eq('id', String(formData.get('id') ?? ''))
    .eq('user_id', user.id);
  if (error) console.error('Failed to publish post:', error.message);
  revalidatePath('/create');
  revalidatePath('/posts');
  revalidatePath('/tournaments');
  revalidatePath(`/people/${user.id}`);
}

export async function deletePost(formData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: removed, error } = await supabase
    .from('posts')
    .delete()
    .eq('id', String(formData.get('id') ?? ''))
    .eq('user_id', user.id)
    .select('image_path');
  if (error) console.error('Failed to delete post:', error.message);
  if (removed?.length) await supabase.storage.from('generations').remove(removed.map((post) => post.image_path));
  revalidatePath('/create');
  revalidatePath('/posts');
  revalidatePath(`/people/${user.id}`);
}

// Records the signed-in user's vote on a post: 1 up, -1 down, 0 to take it back. Returns the post's new score.
export async function vote(postId, value) {
  if (typeof postId !== 'string' || ![-1, 0, 1].includes(value)) return { error: 'That vote could not be saved.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Log in to vote.' };

  let error;
  if (value === 0) {
    ({ error } = await supabase.from('votes').delete().eq('post_id', postId).eq('user_id', user.id));
  } else {
    // Change the existing vote if there is one; otherwise insert a new row.
    const { data: changed, error: updateError } = await supabase
      .from('votes')
      .update({ value })
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .select('post_id');
    error = updateError;
    if (!error && !changed.length) ({ error } = await supabase.from('votes').insert({ post_id: postId, value }));
  }
  if (error) {
    console.error('Failed to save vote:', error.message);
    return { error: 'That vote could not be saved.' };
  }
  const { data: post } = await supabase.from('posts').select('score').eq('id', postId).maybeSingle();
  return { score: post?.score ?? 0, vote: value };
}

// Records the signed-in user's pick in a bracket matchup: 'a', 'b', or null to take it back. Returns the new counts.
export async function voteInMatch(matchId, side) {
  if (typeof matchId !== 'string' || !['a', 'b', null].includes(side)) return { error: 'That vote could not be saved.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Log in to vote.' };

  let error;
  if (side === null) {
    ({ error } = await supabase.from('match_votes').delete().eq('match_id', matchId).eq('user_id', user.id));
  } else {
    const { data: changed, error: updateError } = await supabase
      .from('match_votes')
      .update({ side })
      .eq('match_id', matchId)
      .eq('user_id', user.id)
      .select('match_id');
    error = updateError;
    if (!error && !changed.length) ({ error } = await supabase.from('match_votes').insert({ match_id: matchId, side }));
  }
  if (error) {
    // Row level security rejects votes once the round has ended.
    console.error('Failed to save match vote:', error.message);
    return { error: 'That vote could not be saved. Voting on this matchup may have closed.' };
  }
  const { data: match } = await supabase.from('matches').select('votes_a, votes_b').eq('id', matchId).maybeSingle();
  return { votesA: match?.votes_a ?? 0, votesB: match?.votes_b ?? 0, side };
}
