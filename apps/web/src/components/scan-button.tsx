'use client';

import { useEffect, useRef, useState } from 'react';
import { Sheet } from './sheet';

/** The browser's own barcode reader (Chrome on Android, Edge, and others). */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Scan a house or batch label with the phone's camera (DAILY_ENTRY_UX: scan
 * to select without typing). Uses the browser's own barcode reader — nothing
 * to install — and reads the Code 128 labels this app prints as well as any
 * QR code. Where the browser has no reader, or the camera is refused, the
 * code can be typed instead.
 */
export function ScanButton({ onResult, label = 'Scan a label' }: { onResult: (value: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    const Detector = typeof window !== 'undefined' ? window.BarcodeDetector : undefined;
    if (!Detector) {
      setProblem('This phone’s browser cannot read labels. Type the code on the label instead.');
      return;
    }
    const detector = new Detector({ formats: ['code_128', 'qr_code'] });
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stopped && video.current) {
          const found = await detector.detect(video.current).catch(() => []);
          const value = found[0]?.rawValue?.trim();
          if (value) {
            onResult(value);
            setOpen(false);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch {
        setProblem('The camera could not be opened. Allow the camera, or type the code on the label.');
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, onResult]);

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          setProblem(null);
          setTyped('');
          setOpen(true);
        }}
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          {problem ? (
            <div className="notice notice-warning">{problem}</div>
          ) : (
            <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 'var(--radius-sm)', background: '#000' }} />
          )}
          <form
            className="row"
            style={{ gap: 'var(--sp-2)' }}
            onSubmit={(event) => {
              event.preventDefault();
              if (typed.trim()) {
                onResult(typed.trim());
                setOpen(false);
              }
            }}
          >
            <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Or type the code" style={{ flex: 1 }} />
            <button type="submit" className="btn btn-primary">
              Go
            </button>
          </form>
        </div>
      </Sheet>
    </>
  );
}
