'use client';

import { useEffect, useRef } from 'react';

/**
 * A bottom sheet, built on the native <dialog>.
 *
 * `showModal()` gives focus trapping, Escape-to-close, background inertness and
 * a ::backdrop for free — all of which a div-based modal has to reimplement,
 * usually incompletely. The only thing it does not give is click-outside, which
 * is added below by testing whether the click landed on the dialog's own box
 * rather than the panel inside it.
 *
 * Capped at roughly two-thirds of the viewport so the content behind stays
 * visible: a filter sheet that covers the page hides the thing being filtered.
 */
export function Sheet({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      // Fires on Escape as well as close(); keeps React state in step with the
      // dialog's own idea of whether it is open.
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="sheet-panel">
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            <Close />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}

function Close() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
