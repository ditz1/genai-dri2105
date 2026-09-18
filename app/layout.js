import './globals.css';

export const metadata = {
  title: 'Hello, world — an ASCII experiment',
  description: 'Three-dimensional type, rendered in characters. An interactive Three.js experiment.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
