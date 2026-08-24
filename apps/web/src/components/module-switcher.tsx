'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { switchModule } from '@/app/(app)/module-actions';
import { MODULES, type ModuleKey } from '@/lib/modules';
import { IconChart } from './icons';

/**
 * Picks the species module the whole interface is currently speaking about.
 *
 * Placed above the navigation because it governs everything beneath it: change
 * this and the nav, the page titles and the vocabulary all change with it. A
 * control that reframes the rest of the sidebar belongs above the sidebar.
 *
 * Each option is a form posting to a server action rather than an onClick
 * calling one. That matters: an un-awaited server action leaves its redirect
 * unhandled and the switch silently does nothing, which is exactly what
 * happened the first time this was written. A form submission is the path Next
 * handles end to end, including the redirect and the pending state.
 *
 * Unsubscribed modules are listed but disabled rather than hidden, so the
 * extension path is visible without pretending it is available.
 */
export function ModuleSwitcher({ active }: { active: ModuleKey | null }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /*
   * No module is a real state, not a missing one.
   *
   * This used to fall back to `MODULES[0]` — PoultryPro — so a farm running the
   * platform on its own would have been told it was working in a product it had
   * never bought. Core standing on its own is what §60 describes, and the
   * control should say so.
   */
  const current = MODULES.find((module) => module.key === active) ?? null;
  const CurrentIcon = current?.icon ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="module-switcher" ref={containerRef}>
      <button
        type="button"
        className="module-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="module-trigger-icon">
          {CurrentIcon ? <CurrentIcon size={17} /> : <IconChart size={17} />}
        </span>
        <span className="module-trigger-text">
          <span className="module-trigger-name">
            {current ? current.productName : 'AgriPro Core'}
          </span>
          {/*
            Says what the thing above it is, not what the control does.

            "Switch module" described the button; "on AgriPro Core" describes
            the product — that SnailPro is an extension sitting on a platform,
            which is the single most important fact about how this application
            is put together and was nowhere on screen.
          */}
          <span className="module-trigger-sub">
            {current ? 'on AgriPro Core' : 'no species module'}
          </span>
        </span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div className="module-menu" role="menu" aria-label="Species module">
          <div className="module-menu-head">
            <Link href="/agripro" className="module-core" onClick={() => setOpen(false)}>
              <span className="module-option-text">
                <span className="module-option-name">AgriPro Core</span>
                <span className="module-option-sub">
                  The shared platform — ledger, buying, selling, people
                </span>
              </span>
            </Link>
            <div className="module-menu-label">Species modules on top</div>
          </div>
          {MODULES.map((module) => (
            <form
              key={module.key}
              action={switchModule.bind(null, module.key)}
              onSubmit={() => setOpen(false)}
            >
              <ModuleOption module={module} selected={module.key === active} />
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModuleOption({
  module,
  selected,
}: {
  module: (typeof MODULES)[number];
  selected: boolean;
}) {
  const { pending } = useFormStatus();
  const Icon = module.icon;

  return (
    <button
      type="submit"
      role="menuitemradio"
      aria-checked={selected}
      className="module-option"
      disabled={!module.subscribed || pending}
    >
      <Icon size={17} />
      <span className="module-option-text">
        <span className="module-option-name">{module.productName}</span>
        <span className="module-option-sub">
          {pending && !selected
            ? 'Switching…'
            : `${module.terms.group.many} of ${module.terms.animal.many}`}
        </span>
      </span>
      {module.subscribed ? (
        selected ? (
          <Tick />
        ) : null
      ) : (
        <span className="nav-soon">not subscribed</span>
      )}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        color: 'var(--gray-400)',
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 150ms ease',
      }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Tick() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--brand-700)' }}
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
