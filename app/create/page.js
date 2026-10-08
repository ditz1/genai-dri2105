import { redirect } from 'next/navigation';
import { deletePost, publishPost } from '../actions';
import { getPosts } from '../../lib/posts';
import { getUserAndProfile, hasName } from '../../lib/supabase/server';
import Header from '../header';
import PromptForm from './prompt-form';

export const metadata = { title: 'Create an image' };
// Generating an image can take longer than the default limit for a server action.
export const maxDuration = 60;

export default async function Create() {
  const { supabase, user, profile } = await getUserAndProfile();
  if (!user) redirect('/login');
  if (!hasName(profile)) redirect('/onboarding');
  const drafts = await getPosts(supabase, user, { drafts: true });
  return (
    <main className="feed">
      <Header title="Create" user={user} />
      <PromptForm />
      {drafts.length > 0 && <h2>Not posted yet</h2>}
      <div className="posts">
        {drafts.map((draft) => (
          <article className="post" key={draft.id}>
            <img src={draft.imageUrl} alt={draft.prompt} />
            <p className="prompt">{draft.prompt}</p>
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
