import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPosts } from '../../../lib/posts';
import { getUserAndProfile, hasName } from '../../../lib/supabase/server';
import Header from '../../header';
import PostCard from '../../post-card';
import Silhouette from '../../silhouette';

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export default async function Member({ params }) {
  const { id } = await params;
  const { supabase, user } = await getUserAndProfile();
  if (!supabase || !uuid.test(id)) notFound();
  const { data: member } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, avatar_path, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!hasName(member)) notFound();

  const posts = await getPosts(supabase, user, { authorId: id });
  const own = user?.id === id;
  const avatarUrl = member.avatar_path
    ? supabase.storage.from('avatars').getPublicUrl(member.avatar_path).data.publicUrl
    : null;
  return (
    <main className="feed">
      <Header title={`${member.first_name} ${member.last_name}`} />
      <section className="member">
        {avatarUrl ? <img className="avatar" src={avatarUrl} alt="" /> : <Silhouette className="avatar" />}
        <dl>
          <dt>Member since</dt>
          <dd>{new Date(member.created_at).toLocaleDateString('en-US', { dateStyle: 'long' })}</dd>
          <dt>Posts</dt>
          <dd>{posts.length}</dd>
        </dl>
      </section>
      {posts.length === 0 && (
        <p>{own ? <>You haven't posted anything yet. <Link href="/create">Create an image.</Link></> : 'Nothing posted yet.'}</p>
      )}
      <div className="posts">
        {posts.map((post) => <PostCard key={post.id} post={post} signedIn={Boolean(user)} owned={own} />)}
      </div>
    </main>
  );
}
