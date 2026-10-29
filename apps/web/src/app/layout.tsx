import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { ko } from '@/i18n/ko';
import './globals.css';

export const metadata: Metadata = {
  title: { default: ko.app.name, template: `%s · ${ko.app.name}` },
  description: ko.app.description,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f0ff',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading request headers keeps every page dynamically rendered, which the per-request CSP
  // nonce set by src/proxy.ts requires (Next applies the nonce to its scripts during SSR).
  await headers();
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main">
          {ko.nav.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
