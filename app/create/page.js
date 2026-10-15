import { redirect } from 'next/navigation';
import { deletePost, publishPost } from '../actions';
import { getPosts } from '../../lib/posts';
import { countEntries, getOpenThemes } from '../../lib/themes';
import { getUserAndProfile, hasName } from '../../lib/supabase/server';
import Header from '../header';
import ThemeBanner from '../theme-banner';
import PromptForm from './prompt-form';

export const metadata = { title: 'Create an image' };
// Generating an image can take longer than the default limit for a server action.
export const maxDuration = 60;

export default async function Create({ searchParams }) {
  const { supabase, user, profile } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!hasName(profile)) redirect('/onboarding');
  const [{ theme: requested }, themes] = await Promise.all([searchParams, getOpenThemes(supabase)]);
  const [drafts, entries] = await Promise.all([
    getPosts(supabase, user, { drafts: true }),
    countEntries(supabase, themes.map((theme) => theme.id)),
  ]);
  const openIds = themes.map((theme) => theme.id);
  const chosen = themes.find((theme) => String(theme.id) === requested) ?? themes[0];
  return (
    <main className="feed">
      <Header title="Create" />
      {themes.length === 0 && <ThemeBanner />}
      {themes.map((theme) => <ThemeBanner key={theme.id} theme={theme} entries={entries[theme.id] ?? 0} />)}
      <PromptForm themes={themes.map(({ id, title }) => ({ id, title }))} defaultThemeId={chosen?.id ?? null} />
      {drafts.length > 0 && <h2>Not posted yet</h2>}
      <div className="posts">
        {drafts.map((draft) => (
          <article className="post" key={draft.id}>
            <img src={draft.imageUrl} alt={draft.prompt} />
            <p className="prompt">{draft.prompt}</p>
            {draft.theme && <p className="meta">For {draft.theme}</p>}
            {!openIds.includes(draft.themeId) && <p className="meta">Its theme isn't taking entries any more, so posting it won't enter a bracket.</p>}
            <form className="votes">
              <input type="hidden" name="id" value={draft.id} />
              <button formAction={publishPost}>Post</button>
              <button formAction={deletePost} className="secondary">Discard</button>
            </form>
          </article>
        ))}
      </div>
    </main>
  );
}
