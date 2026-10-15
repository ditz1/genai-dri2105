'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

function remaining(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes >= 60 * 24) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// Time left until `until`. Once it passes, the page reloads its data so the next round (or the champion) shows up.
export default function Countdown({ until }) {
  const router = useRouter();
  const [now, setNow] = useState(null);
  const end = new Date(until).getTime();
  const done = now !== null && now >= end;

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Rounds are closed by the database; refresh until the page reflects it.
  useEffect(() => {
    if (!done) return;
    const timer = setInterval(() => router.refresh(), 15000);
    const first = setTimeout(() => router.refresh(), 1500);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [done, router]);

  // The server's time zone may differ from the visitor's, so the first render's text is allowed to change on hydration.
  if (now === null) return <span suppressHydrationWarning>{new Date(until).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>;
  return <span>{done ? 'closing…' : remaining(end - now)}</span>;
}
