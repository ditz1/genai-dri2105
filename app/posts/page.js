import Link from 'next/link';
import { getPosts } from '../../lib/posts';
import { getUserAndProfile } from '../../lib/supabase/server';
import Header from '../header';
import PostCard from '../post-card';

export const metadata = { title: 'Posts' };

export default async function Posts() {
  const { supabase, user } = await getUserAndProfile();
  const posts = await getPosts(supabase, user);
  return (
    <main className="feed">
      <Header title="Posts" />
      {posts.length === 0 && <p>No images have been posted yet. <Link href="/create">Create the first one.</Link></p>}
      <div className="posts">
        {posts.map((post) => <PostCard key={post.id} post={post} signedIn={Boolean(user)} owned={post.userId === user?.id} />)}
      </div>
    </main>
  );
}
