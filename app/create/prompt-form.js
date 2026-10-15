'use client';

import { useActionState } from 'react';
import { generatePost } from '../actions';

// When more than one theme is open, the member picks which one the image is for.
export default function PromptForm({ themes, defaultThemeId }) {
  const [state, formAction, pending] = useActionState(generatePost, {});
  const single = themes.length === 1 ? themes[0] : null;
  return (
    <form className="prompt-form" action={formAction}>
      {themes.length > 1 && (
        <fieldset className="theme-choice">
          <legend>Which theme is this image for?</legend>
          {themes.map((theme) => (
            <label key={theme.id}>
              <input type="radio" name="theme_id" value={theme.id} defaultChecked={theme.id === (state.themeId ?? defaultThemeId)} />
              <span>{theme.title}</span>
            </label>
          ))}
        </fieldset>
      )}
      {single && <input type="hidden" name="theme_id" value={single.id} />}
      <label htmlFor="prompt">
        Describe an image{single ? ` for the theme ${single.title}` : ''} and AI will generate it. You choose whether to post it; posted images enter the theme's bracket when its entries close.
      </label>
      <textarea id="prompt" name="prompt" rows={3} maxLength={500} defaultValue={state.prompt ?? ''} placeholder="A lighthouse made of glass at sunrise" required />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button disabled={pending}>{pending ? 'Generating…' : 'Generate'}</button>
    </form>
  );
}
