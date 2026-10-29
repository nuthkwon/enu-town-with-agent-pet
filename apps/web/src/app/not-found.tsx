import Link from 'next/link';
import { buttonClass } from '@/components/ui';
import s from '@/components/status-page.module.css';
import { ko } from '@/i18n/ko';

export default function NotFound() {
  return (
    <main id="main" className={s.wrap}>
      <div className={s.card}>
        <div className={s.code}>404</div>
        <h1>{ko.notFound.title}</h1>
        <p className={s.body}>{ko.notFound.body}</p>
        <div className={s.actions}>
          <Link href="/town" className={buttonClass('primary')}>
            {ko.notFound.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
