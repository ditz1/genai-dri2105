import { Suspense } from 'react';
import { getUserAndProfile } from '../lib/supabase/server';
import './globals.css';
import Nav from './nav';
import Scene from './scene';

export const metadata = {
  title: 'People — a profile board',
  description: 'A board of member profiles, with Google sign-in and photos stored in Supabase.',
};

// Looks up who is signed in for the account link. It sits in its own Suspense boundary so pages never wait on it.
async function AccountNav() {
  const { user, isAdmin } = await getUserAndProfile();
  return <Nav signedIn={Boolean(user)} admin={isAdmin} />;
}

// The 3D background and the navigation live here, so they stay in place while pages change underneath them.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Scene />
        <Suspense fallback={<Nav />}>
          <AccountNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
