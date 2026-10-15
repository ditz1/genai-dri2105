// The page's title. Navigation lives in the root layout (app/nav.js) so it stays put between pages.
export default function Header({ title }) {
  return (
    <header className="site-header">
      <h1>{title}</h1>
    </header>
  );
}
