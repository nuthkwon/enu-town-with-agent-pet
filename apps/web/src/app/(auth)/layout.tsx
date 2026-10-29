import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteHeader';
import s from '@/components/site.module.css';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main id="main" className={s.authShell}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
