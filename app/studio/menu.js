'use client';

import { useEffect, useRef, useState } from 'react';

// A small popover menu. It closes when an item is chosen, on a click or tap anywhere outside it, on Escape
// (returning focus to the trigger), and when focus moves elsewhere. Arrow keys move between items.
export default function Menu({ label, trigger, items }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event) => !root.current?.contains(event.target) && setOpen(false);
    const key = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', key);
    root.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const moveFocus = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...root.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = options.indexOf(document.activeElement);
    const next = options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length];
    next?.focus();
  };

  return (
    <div className="menu" ref={root}>
      <button ref={button} type="button" className={`menu-trigger ${open ? 'open' : ''}`} aria-label={label}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {trigger}
      </button>
      {open && (
        <div className="menu-items" role="menu" aria-label={label} onKeyDown={moveFocus}>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? 'danger' : ''} disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
