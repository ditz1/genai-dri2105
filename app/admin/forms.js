'use client';

import { useActionState } from 'react';
import { createGeminiTheme, createTheme, saveSettings, updateTheme } from './actions';

function Status({ state }) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.message) return <p className="meta" role="status">{state.message}</p>;
  return null;
}

// Opens a new theme next to any that are already running: written here, or suggested by Gemini.
export function NewThemeForm({ themeHours }) {
  const [createState, create, creating] = useActionState(createTheme, {});
  const [geminiState, createFromGemini, asking] = useActionState(createGeminiTheme, {});
  const busy = creating || asking;
  return (
    <form className="admin-form" action={create}>
      <label>Title<input name="title" maxLength={80} required /></label>
      <label>Description<textarea name="description" rows={2} maxLength={400} /></label>
      <div className="form-row">
        <label>Opens in (hours)<input type="number" name="starts_in" min={0} max={720} step={0.25} defaultValue={0} /></label>
        <label>Takes entries for (hours)<input type="number" name="hours" min={0.25} max={720} step={0.25} defaultValue={themeHours} /></label>
      </div>
      <div className="votes">
        <button disabled={busy}>{creating ? 'Opening…' : 'Open this theme'}</button>
        <button formAction={createFromGemini} formNoValidate className="secondary" disabled={busy}>
          {asking ? 'Asking Gemini…' : 'Open a theme from Gemini'}
        </button>
      </div>
      <Status state={createState} />
      <Status state={geminiState} />
    </form>
  );
}

// Rewords one existing theme.
export function ThemeEditor({ theme }) {
  const [state, action, pending] = useActionState(updateTheme, {});
  return (
    <form className="admin-form" action={action}>
      <input type="hidden" name="theme" value={theme.id} />
      <label>Title<input name="title" maxLength={80} required defaultValue={theme.title} key={`title-${theme.title}`} /></label>
      <label>Description<textarea name="description" rows={2} maxLength={400} defaultValue={theme.description} key={`description-${theme.description}`} /></label>
      <div className="votes"><button className="secondary" disabled={pending}>{pending ? 'Saving…' : 'Save wording'}</button></div>
      <Status state={state} />
    </form>
  );
}

export function SettingsForm({ settings }) {
  const [state, action, pending] = useActionState(saveSettings, {});
  return (
    <form className="admin-form" action={action}>
      <div className="form-row">
        <label>Hours new themes take entries<input type="number" name="theme_hours" min={1} max={720} defaultValue={settings.theme_hours} required /></label>
        <label>Hours of voting per round<input type="number" name="round_hours" min={1} max={168} defaultValue={settings.round_hours} required /></label>
      </div>
      <p className="meta">Changes apply to themes opened and rounds started after saving.</p>
      <div className="votes"><button disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</button></div>
      <Status state={state} />
    </form>
  );
}
