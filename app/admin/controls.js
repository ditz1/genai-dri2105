'use client';

import {
  cancelTournament,
  endRound,
  finishTournament,
  pauseTournament,
  reseedTournament,
  removeTheme,
  resumeTournament,
  setEntriesLeft,
  setMatchWinner,
  setTimeLeft,
  startTournament,
} from './actions';

// Asks before actions that throw away votes or end a bracket.
function confirmFirst(message) {
  return (event) => {
    if (!window.confirm(message)) event.preventDefault();
  };
}

// Everything an admin can do to one bracket, depending on whether it is running, paused or over.
export function TournamentControls({ tournament }) {
  const { id, status } = tournament;
  const active = status === 'running' || status === 'paused';
  return (
    <form className="controls">
      <input type="hidden" name="theme" value={id} />
      {active && <button formAction={endRound} title="Decide this round's matchups now and open the next round">End round now</button>}
      {status === 'running' && <button formAction={pauseTournament} className="secondary" title="Stop the clock and voting until resumed">Pause</button>}
      {status === 'paused' && <button formAction={resumeTournament} className="secondary" title="Restart the clock with the time that was left">Resume</button>}
      {active && (
        <span className="time-left">
          <input type="number" name="hours" min={0} max={168} step={0.25} placeholder="Hours" aria-label="Hours left in this round" />
          <button formAction={setTimeLeft} className="secondary">Set time left</button>
        </span>
      )}
      {active && (
        <button formAction={finishTournament} className="secondary" onClick={confirmFirst('Decide every remaining round now? Rounds nobody has voted on go to the higher seed.')}>
          Finish now
        </button>
      )}
      {active && (
        <button formAction={cancelTournament} className="secondary" onClick={confirmFirst('Cancel this bracket? It will be hidden and won’t crown a champion.')}>
          Cancel
        </button>
      )}
      <button formAction={reseedTournament} className="secondary" onClick={confirmFirst('Re-seed this bracket? All of its matchup votes will be lost.')}>
        Re-seed
      </button>
    </form>
  );
}

// Lets an admin decide a matchup in the current round, or reopen one they decided.
export function MatchControls({ match, themeId }) {
  const decided = Boolean(match.winnerId);
  return (
    <form className="controls">
      <input type="hidden" name="theme" value={themeId} />
      <input type="hidden" name="match" value={match.id} />
      {match.a && match.winnerId !== match.a.id && <button formAction={setMatchWinner} name="side" value="a" className="secondary">{match.a.author} (left) wins</button>}
      {match.b && match.winnerId !== match.b.id && <button formAction={setMatchWinner} name="side" value="b" className="secondary">{match.b.author} (right) wins</button>}
      {decided && match.a && match.b && <button formAction={setMatchWinner} name="side" value="" className="secondary">Reopen voting</button>}
    </form>
  );
}

// For a theme that is taking entries (or hasn't opened yet): change how long it stays open, or close it and start
// its bracket now. Themes that haven't opened can be removed.
export function ThemeWindowControls({ theme, upcoming = false }) {
  return (
    <form className="controls">
      <input type="hidden" name="theme" value={theme.id} />
      <span className="time-left">
        <input type="number" name="hours" min={0} max={720} step={0.25} placeholder="Hours" aria-label="Hours until entries close" />
        <button formAction={setEntriesLeft} className="secondary">Set entries left</button>
      </span>
      {upcoming ? (
        <button formAction={removeTheme} className="secondary" onClick={confirmFirst('Remove this theme before it opens?')}>Remove</button>
      ) : (
        <button formAction={startTournament} onClick={confirmFirst('Close entries for this theme now and start its bracket?')}>Close entries &amp; start bracket</button>
      )}
    </form>
  );
}
