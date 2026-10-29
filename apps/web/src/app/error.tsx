'use client';

import Link from 'next/link';
import { Button, buttonClass } from '@/components/ui';
import s from '@/components/status-page.module.css';
import { ko } from '@/i18n/ko';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className={s.wrap}>
      <div className={s.card}>
        <div className={s.code}>!</div>
        <h1>{ko.errorPage.title}</h1>
        <p className={s.body}>{ko.errorPage.body}</p>
        <div className={s.actions}>
          <Button onClick={() => reset()}>{ko.errorPage.retry}</Button>
          <Link href="/town" className={buttonClass('ghost')}>
            {ko.errorPage.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
