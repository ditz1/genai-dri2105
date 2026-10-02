'use client';

import { useActionState } from 'react';
import { completeOnboarding } from '../actions';

export default function NameForm({ firstName, lastName }) {
  const [state, formAction, pending] = useActionState(completeOnboarding, {});
  return (
    <form action={formAction}>
      <label htmlFor="first_name">First name</label>
      <input id="first_name" name="first_name" defaultValue={firstName} autoComplete="given-name" maxLength={80} required />
      <label htmlFor="last_name">Last name</label>
      <input id="last_name" name="last_name" defaultValue={lastName} autoComplete="family-name" maxLength={80} required />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button disabled={pending}>{pending ? 'Saving…' : 'Continue'}</button>
    </form>
  );
}
