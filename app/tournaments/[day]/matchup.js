'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { voteInMatch } from '../../actions';

// One open head-to-head matchup. Signed-in members pick a side; picking it again takes the vote back.
export default function Matchup({ match, signedIn }) {
  const [votes, setVotes] = useState({ a: match.votesA, b: match.votesB });
  const [myVote, setMyVote] = useState(match.myVote);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function pick(side) {
    const next = side === myVote ? null : side;
    const previous = { votes, myVote };
    const counts = { ...votes };
    if (myVote) counts[myVote] -= 1;
    if (next) counts[next] += 1;
    setVotes(counts);
    setMyVote(next);
    setError(null);
    startTransition(async () => {
      const result = await voteInMatch(match.id, next);
      if (result.error) {
        setVotes(previous.votes);
        setMyVote(previous.myVote);
        setError(result.error);
      } else {
        setVotes({ a: result.votesA, b: result.votesB });
      }
    });
  }

  const total = votes.a + votes.b;
  return (
    <article className="matchup">
      <div className="matchup-sides">
        {['a', 'b'].map((side, index) => {
          const entry = match[side];
          const share = total ? Math.round((votes[side] / total) * 100) : 0;
          return (
            <div className={`matchup-side${myVote === side ? ' picked' : ''}`} key={side}>
              {index === 1 && <span className="versus" aria-hidden="true">vs</span>}
              <img src={entry.imageUrl} alt={entry.prompt} loading="lazy" />
              <p className="prompt">{entry.prompt}</p>
              <p className="meta"><Link href={`/people/${entry.userId}`}>{entry.author}</Link></p>
              <div className="share" aria-hidden="true"><span style={{ width: `${share}%` }} /></div>
              <div className="votes">
                {signedIn ? (
                  <button type="button" aria-pressed={myVote === side} disabled={pending} onClick={() => pick(side)}>
                    {myVote === side ? 'Voted' : 'Vote'}
                  </button>
                ) : null}
                <span>{votes[side]} {votes[side] === 1 ? 'vote' : 'votes'}</span>
              </div>
            </div>
          );
        })}
      </div>
      {!signedIn && <p className="meta"><Link href="/login">Log in to vote</Link></p>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}
