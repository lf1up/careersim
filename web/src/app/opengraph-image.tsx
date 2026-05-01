import { ImageResponse } from 'next/og';

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo';

export const alt = `${SITE_NAME} preview`;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#f8f1dc',
          border: '18px solid #111827',
          color: '#111827',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'center',
          padding: '72px',
          width: '100%',
        }}
      >
        <div
          style={{
            background: '#67e8f9',
            border: '8px solid #111827',
            boxShadow: '14px 14px 0 #111827',
            display: 'flex',
            flexDirection: 'column',
            gap: '28px',
            padding: '56px',
            width: '100%',
          }}
        >
          <div style={{ fontSize: 82, fontWeight: 900, letterSpacing: -3 }}>
            {SITE_NAME}
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.15 }}>
            AI career simulation practice
          </div>
          <div style={{ color: '#374151', fontSize: 28, lineHeight: 1.35 }}>
            {SITE_DESCRIPTION}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
