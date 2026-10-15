'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { ViewTransition, useEffect, useRef } from 'react';
import { accentFor } from '../lib/route-theme';

const sections = [
  { href: '/', label: 'People', matches: (path) => path === '/' || path.startsWith('/people/') },
  { href: '/posts', label: 'Posts' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/create', label: 'Create' },
];
const adminLink = { href: '/admin', label: 'Admin' };
const profileLink = { href: '/profile', label: 'Profile', matches: (path) => path === '/profile' || path === '/onboarding' };
const loginLink = { href: '/login', label: 'Log in' };

const isActive = (item, path) => (item.matches ? item.matches(path) : path === item.href || path.startsWith(`${item.href}/`));

// A dot that pulses on the clicked link until its page starts to show.
function Pending() {
  const { pending } = useLinkStatus();
  return <span className={`nav-pending${pending ? ' is-pending' : ''}`} aria-hidden="true" />;
}

// The floating bar at the top of every page. The highlight glides to the current section, and pages slide in the
// direction of the link that was clicked. `signedIn` is undefined while the account is still being looked up.
export default function Nav({ signedIn, admin = false }) {
  const pathname = usePathname();
  const items = [...sections, ...(admin ? [adminLink] : [])];
  const account = signedIn === undefined ? null : signedIn ? profileLink : loginLink;
  const all = account ? [...items, account] : items;
  const activeIndex = all.findIndex((item) => isActive(item, pathname));

  const strip = useRef(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--route-accent', accentFor(pathname));
  }, [pathname]);

  // On narrow screens the links scroll sideways: keep the current one in view and fade whichever edge has more.
  function markEdges() {
    const element = strip.current;
    if (!element) return;
    element.classList.toggle('more-before', element.scrollLeft > 2);
    element.classList.toggle('more-after', element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  }
  useEffect(() => {
    const element = strip.current;
    const active = element?.querySelector('[aria-current="page"]');
    if (active) element.scrollTo({ left: active.offsetLeft - (element.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
    markEdges();
    window.addEventListener('resize', markEdges);
    return () => window.removeEventListener('resize', markEdges);
  }, [pathname, admin]);

  function link(item, index, className = 'nav-link') {
    const active = index === activeIndex;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={className}
        aria-current={active ? 'page' : undefined}
        transitionTypes={[activeIndex !== -1 && index < activeIndex ? 'nav-back' : 'nav-forward']}
      >
        {active && (
          <ViewTransition name="nav-highlight" share="nav-glide" default="none">
            <span className="nav-highlight" aria-hidden="true" />
          </ViewTransition>
        )}
        <span className="nav-label">{item.label}</span>
        <Pending />
      </Link>
    );
  }

  return (
    <ViewTransition name="site-nav" default="none">
      <nav className="nav" aria-label="Main">
        <div className="nav-links" ref={strip} onScroll={markEdges}>{items.map((item, index) => link(item, index))}</div>
        <span className="nav-divider" aria-hidden="true" />
        {account ? link(account, items.length, 'nav-link nav-account') : <span className="nav-link nav-account nav-placeholder" aria-hidden="true" />}
      </nav>
    </ViewTransition>
  );
}
