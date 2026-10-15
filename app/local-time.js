'use client';

import { useEffect, useState } from 'react';

const format = (value, timeZone) =>
  new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }) + (timeZone ? ` ${timeZone}` : '');

// A date and time in the visitor's own time zone. The server doesn't know that zone, so the first render (on the
// server and while hydrating) shows UTC, and the browser switches to local time once it is running.
export default function LocalTime({ value }) {
  const [local, setLocal] = useState(null);
  useEffect(() => setLocal(format(value)), [value]);
  return <time dateTime={value}>{local ?? format(value, 'UTC')}</time>;
}
