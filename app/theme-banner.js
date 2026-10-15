import { formatDay } from '../lib/themes';

// Short name of a time zone right now, like "EDT".
function zoneName(timezone) {
  if (!timezone) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')?.value ?? timezone;
}

// Today's theme, how many images have been entered, and when the bracket starts.
export default function ThemeBanner({ today, entries, children }) {
  if (!today?.day) return null;
  return (
    <section className="theme">
      <p className="eyebrow">Today's theme · {formatDay(today.day, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h2>{today.theme?.title ?? 'No theme yet'}</h2>
      {today.theme?.description && <p>{today.theme.description}</p>}
      <p className="meta">
        {entries} {entries === 1 ? 'image' : 'images'} entered so far. Every image posted today goes into a bracket at midnight {zoneName(today.timezone)}, and members vote each matchup until one is crowned.
      </p>
      {children}
    </section>
  );
}
