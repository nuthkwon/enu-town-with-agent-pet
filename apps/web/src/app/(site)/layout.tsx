import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import s from '@/components/site.module.css';
import { getPageViewer } from '@/server/page-session';

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const viewer = await getPageViewer();
  return (
    <>
      <SiteHeader viewer={viewer ? { name: viewer.name, isAdmin: viewer.isAdmin } : null} />
      <main id="main" className={s.main}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
