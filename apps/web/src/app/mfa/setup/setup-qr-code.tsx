'use client';

import { QRCodeSVG } from 'qrcode.react';

export function SetupQrCode({ value }: { value: string }) {
  return (
    <div
      style={{
        alignSelf: 'center',
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-3)',
      }}
    >
      <QRCodeSVG
        value={value}
        size={220}
        level="M"
        includeMargin
        title="Scan to add BioAssetPro to your authenticator app"
      />
    </div>
  );
}
