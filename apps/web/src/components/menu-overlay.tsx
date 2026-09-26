'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Dims the page behind an open dropdown so the panel stands out. Rendered on
 * the document body: the header's blur makes it the containing block for
 * anything fixed inside it, so an overlay placed there would cover only the
 * header. It sits just under the header, which stays clear.
 */
export function MenuOverlay({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<div className="menu-overlay" aria-hidden="true" onMouseDown={onClose} />, document.body);
}
