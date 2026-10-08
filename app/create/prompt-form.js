'use client';

import { useActionState } from 'react';
import { generatePost } from '../actions';

export default function PromptForm() {
  const [state, formAction, pending] = useActionState(generatePost, {});
  return (
    <form className="prompt-form" action={formAction}>
      <label htmlFor="prompt">Describe an image and AI will generate it. You choose whether to post it.</label>
      <textarea id="prompt" name="prompt" rows={3} maxLength={500} defaultValue={state.prompt ?? ''} placeholder="A lighthouse made of glass at sunrise" required />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button disabled={pending}>{pending ? 'Generating…' : 'Generate'}</button>
    </form>
  );
}
