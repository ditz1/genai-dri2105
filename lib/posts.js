const formatDate = (value) => new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' });

// Posted images, newest first, optionally one member's. With `drafts`, the signed-in user's unposted images instead.
// Row level security returns only the viewer's own votes, so `myVote` is theirs (or 0).
export async function getPosts(supabase, user, { authorId, drafts = false, limit = 60 } = {}) {
  if (!supabase) return [];
  let query = supabase
    .from('posts')
    .select(`id, user_id, prompt, model, image_path, score, posted_at, created_at, theme_id, theme:themes(title), author:profiles!posts_user_id_fkey(first_name, last_name)${user ? ', votes(value)' : ''}`)
    .limit(limit);
  query = drafts
    ? query.is('posted_at', null).eq('user_id', user.id).order('created_at', { ascending: false })
    : query.not('posted_at', 'is', null).order('posted_at', { ascending: false });
  if (authorId) query = query.eq('user_id', authorId);

  const { data, error } = await query;
  if (error) {
    console.error('Failed to load posts from Supabase:', error.message);
    return [];
  }
  return data.map((post) => ({
    id: post.id,
    userId: post.user_id,
    prompt: post.prompt,
    model: post.model,
    score: post.score,
    date: formatDate(post.posted_at ?? post.created_at),
    author: `${post.author?.first_name ?? ''} ${post.author?.last_name ?? ''}`.trim() || 'A member',
    imageUrl: supabase.storage.from('generations').getPublicUrl(post.image_path).data.publicUrl,
    myVote: post.votes?.[0]?.value ?? 0,
    themeId: post.theme_id,
    theme: post.theme?.title ?? null,
  }));
}
