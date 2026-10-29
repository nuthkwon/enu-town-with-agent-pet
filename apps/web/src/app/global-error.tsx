'use client';

import { ko } from '@/i18n/ko';
import './globals.css';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div>
            <h1>{ko.errorPage.title}</h1>
            <p>{ko.errorPage.body}</p>
            <button
              type="button"
              onClick={() => reset()}
              style={{ padding: '8px 18px', borderRadius: 999, cursor: 'pointer' }}
            >
              {ko.errorPage.retry}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
