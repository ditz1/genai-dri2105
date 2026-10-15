'use client';

import { useActionState } from 'react';
import { generateTheme, saveSettings, saveTheme } from './actions';

function Status({ state }) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.message) return <p className="meta" role="status">{state.message}</p>;
  return null;
}

// Writes a day's theme by hand, or asks Gemini for a new one. Without a theme, the date can be changed to schedule one.
export function ThemeForm({ theme, day, fixedDay = false }) {
  const [saveState, save, saving] = useActionState(saveTheme, {});
  const [generateState, generate, generating] = useActionState(generateTheme, {});
  return (
    <form className="admin-form" action={save}>
      {fixedDay ? (
        <input type="hidden" name="day" value={day} />
      ) : (
        <label>Date<input type="date" name="day" defaultValue={day} required /></label>
      )}
      <label>Title<input name="title" maxLength={80} required defaultValue={theme?.title ?? ''} key={`title-${theme?.title}`} /></label>
      <label>Description<textarea name="description" rows={2} maxLength={400} defaultValue={theme?.description ?? ''} key={`description-${theme?.description}`} /></label>
      <div className="votes">
        <button disabled={saving || generating}>{saving ? 'Saving…' : 'Save'}</button>
        <button formAction={generate} formNoValidate className="secondary" disabled={saving || generating}>
          {generating ? 'Asking Gemini…' : 'New theme from Gemini'}
        </button>
      </div>
      <Status state={saveState} />
      <Status state={generateState} />
    </form>
  );
}

export function SettingsForm({ settings }) {
  const [state, action, pending] = useActionState(saveSettings, {});
  return (
    <form className="admin-form" action={action}>
      <label>Hours of voting per round<input type="number" name="round_hours" min={1} max={168} defaultValue={settings.round_hours} required /></label>
      <label>Time zone for theme days<input name="timezone" defaultValue={settings.timezone} required /></label>
      <p className="meta">New round lengths apply from the next round that opens.</p>
      <div className="votes"><button disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</button></div>
      <Status state={state} />
    </form>
  );
}
