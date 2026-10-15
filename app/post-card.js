'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { deletePost, vote } from './actions';

// One posted image with its prompt and score. Signed-in viewers can vote; the owner can delete it.
export default function PostCard({ post, signedIn, owned }) {
  const [score, setScore] = useState(post.score);
  const [myVote, setMyVote] = useState(post.myVote);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // Clicking the vote you already cast takes it back.
  function cast(value) {
    const next = value === myVote ? 0 : value;
    const previous = { score, myVote };
    setScore(score - myVote + next);
    setMyVote(next);
    setError(null);
    startTransition(async () => {
      const result = await vote(post.id, next);
      if (result.error) {
        setScore(previous.score);
        setMyVote(previous.myVote);
        setError(result.error);
      } else {
        setScore(result.score);
      }
    });
  }

  return (
    <article className="post">
      <img src={post.imageUrl} alt={post.prompt} loading="lazy" />
      <p className="prompt">{post.prompt}</p>
      <p className="meta">
        <Link href={`/people/${post.userId}`}>{post.author}</Link> · {post.date}
        {post.theme && <> · {post.theme}</>}
      </p>
      <div className="votes">
        {signedIn ? (
          <>
            <button type="button" aria-label="Upvote" aria-pressed={myVote === 1} disabled={pending} onClick={() => cast(1)}>▲</button>
            <span aria-label={`Score ${score}`}>{score}</span>
            <button type="button" aria-label="Downvote" aria-pressed={myVote === -1} disabled={pending} onClick={() => cast(-1)}>▼</button>
          </>
        ) : (
          <>
            <span>Score {score}</span>
            <Link href="/login">Log in to vote</Link>
          </>
        )}
        {owned && (
          <form action={deletePost}>
            <input type="hidden" name="id" value={post.id} />
            <button className="secondary">Delete</button>
          </form>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}
