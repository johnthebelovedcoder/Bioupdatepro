'use client';

/** Print the current page. Navigation is hidden by the print stylesheet. */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" className="btn" onClick={() => window.print()}>
      {label}
    </button>
  );
}
