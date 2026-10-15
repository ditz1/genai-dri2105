import Countdown from './countdown';

// A theme that is taking entries: what it is, how many images are in, and when its bracket starts.
export default function ThemeBanner({ theme, entries, children }) {
  if (!theme) {
    return (
      <section className="theme">
        <p className="eyebrow">Theme</p>
        <h2>No theme is open right now</h2>
        <p className="meta">A new one will be along soon.</p>
      </section>
    );
  }
  return (
    <section className="theme">
      <p className="eyebrow">Open theme · entries close in <Countdown until={theme.closesAt} /></p>
      <h2>{theme.title}</h2>
      {theme.description && <p>{theme.description}</p>}
      <p className="meta">
        {entries} {entries === 1 ? 'image' : 'images'} entered so far. When entries close, every image posted for this theme goes into a bracket, and members vote each matchup until one is crowned.
      </p>
      {children}
    </section>
  );
}
