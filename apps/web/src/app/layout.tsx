import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BioAssetPro',
  description: 'Farm management and accounting, built for how farms actually work',
};

/**
 * `width=device-width` is what makes the whole responsive layer take effect;
 * without it a phone renders at a 980px virtual width and simply shrinks the
 * page. Zoom is deliberately left enabled — figures on this screen are the sort
 * people need to be able to enlarge.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1f6b3f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
