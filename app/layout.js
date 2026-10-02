import './globals.css';

export const metadata = {
  title: 'People — a profile board',
  description: 'A board of member profiles, with Google sign-in and photos stored in Supabase.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
