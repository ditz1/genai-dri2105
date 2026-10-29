import { generateImage } from './generate.js';

const variations = [
  'a floating botanical island, luminous flowers, cinematic digital painting',
  'a tiny robot tending orchids in a glass dome, watercolor illustration',
  'a moonlit garden with bioluminescent pools, dramatic oil painting',
  'a greenhouse orbiting a distant planet, retro science fiction poster',
  'a fox exploring a garden of crystal trees, intricate storybook art',
  'a waterfall flowing through terraced flower beds, dreamy landscape art',
  'a moss-covered observatory among giant blooms, atmospheric concept art',
  'a miniature city inside a blooming terrarium, playful isometric art',
];

export async function createSimulationRun(supabase, title, count) {
  if (!title || title.length > 70 || !Number.isInteger(count) || count < 2 || count > 8) throw new Error('Enter a title of up to 70 characters and 2–8 participants.');
  const { data: users, error } = await supabase.rpc('admin_simulation_users');
  if (error) throw new Error(error.message);
  if (users.length < count) throw new Error(`Only ${users.length} fake users without emails are available. This demo needs ${count}.`);
  const { data: theme, error: themeError } = await supabase.from('themes').insert({ title: `Demo · ${title}`,
    description: 'Simulation using test accounts without email addresses and AI-generated artwork.',
    closes_at: new Date(Date.now() + 86400000).toISOString() }).select('id').single();
  if (themeError) throw new Error(themeError.message);
  const { data: run, error: runError } = await supabase.from('simulation_runs').insert({ theme_id: theme.id,
    participants: users.slice(0, count).map((u) => u.id) }).select('*').single();
  if (runError) { await supabase.from('themes').delete().eq('id', theme.id); throw new Error(runError.message); }
  return run;
}

export async function populateSimulation(supabase, runId, onProgress = () => {}) {
  const { data: run, error } = await supabase.from('simulation_runs').select('*,theme:themes(title)').eq('id', runId).single();
  if (error || !run) throw new Error('Demo run could not be found.');
  const { data: users, error: usersError } = await supabase.rpc('admin_simulation_users');
  if (usersError || run.participants.some((id) => !users?.some((u) => u.id === id))) throw new Error('Every demo participant must still have no email and must not be an admin.');
  const { data: existing, error: entriesError } = await supabase.from('posts').select('user_id').eq('theme_id', run.theme_id);
  if (entriesError) throw new Error(entriesError.message);
  const missing = run.participants.filter((id) => !existing.some((post) => post.user_id === id));
  for (let offset = 0; offset < missing.length; offset += 2) {
    const results = await Promise.allSettled(missing.slice(offset, offset + 2).map(async (userId) => {
      const prompt = `${run.theme.title}: ${variations[run.participants.indexOf(userId)]}. No text or lettering.`;
      const image = await generateImage(prompt, { supabase, userId, themeId: run.theme_id });
      const path = `${userId}/${crypto.randomUUID()}.${image.extension}`;
      const bucket = supabase.storage.from('generations');
      const { error: uploadError } = await bucket.upload(path, image.bytes, { contentType: image.contentType });
      if (uploadError) throw new Error(uploadError.message);
      const { data: post, error: postError } = await supabase.from('posts').insert({ user_id: userId, prompt,
        caption: `Demo artwork · ${run.theme.title}`, model: image.model, image_path: path,
        theme_id: run.theme_id, posted_at: new Date().toISOString() }).select('id').single();
      if (postError) { await bucket.remove([path]); throw new Error(postError.message); }
      if (image.requestId) {
        const { error: linkError } = await supabase.from('generation_requests').update({ post_id: post.id }).eq('id', image.requestId);
        if (linkError) throw new Error(linkError.message);
      }
      onProgress({ userId, postId: post.id });
    }));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  const { error: startError } = await supabase.rpc('admin_start_simulation', { target_run: runId });
  if (startError) throw new Error(startError.message);
  return run;
}
