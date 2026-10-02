'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export default function GoogleButton() {
  const [status, setStatus] = useState('idle');

  async function signIn() {
    setStatus('pending');
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setStatus('error');
  }

  return (
    <>
      <button type="button" onClick={signIn} disabled={status === 'pending'}>
        {status === 'pending' ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {status === 'error' && <p className="error" role="alert">Could not start Google sign-in. Try again.</p>}
    </>
  );
}
