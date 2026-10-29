import Link from 'next/link';
import { ko } from '@/i18n/ko';
import { SignOutButton } from './SignOutButton';
import { buttonClass } from './ui';
import s from './site.module.css';

export function Logo() {
  return (
    <Link href="/" className={s.logo} aria-label={ko.app.name}>
      <span className={s.logoMark} aria-hidden="true">
        ✦
      </span>
      <span className={s.logoText}>{ko.app.name}</span>
      <span className={s.logoSub}>{ko.app.tagline}</span>
    </Link>
  );
}

export function SiteHeader({ viewer }: { viewer: { name: string; isAdmin: boolean } | null }) {
  return (
    <header className={s.header}>
      <div className={s.headerInner}>
        <Logo />
        <nav className={s.nav} aria-label={ko.nav.mainMenu}>
          {viewer ? (
            <>
              <Link href="/" className={s.navLink}>
                {ko.nav.messenger}
              </Link>
              <Link href="/town" className={s.navLink}>
                {ko.nav.town}
              </Link>
              <Link href="/me" className={s.navLink}>
                {ko.nav.me}
              </Link>
              {viewer.isAdmin && (
                <Link href="/admin" className={s.navLink}>
                  {ko.nav.admin}
                </Link>
              )}
              <SignOutButton />
            </>
          ) : (
            <Link href="/sign-in" className={buttonClass('secondary', 'sm')}>
              {ko.nav.signIn}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <Link href="/privacy">{ko.nav.privacy}</Link>
      <span aria-hidden="true">·</span>
      <Link href="/credits">{ko.nav.credits}</Link>
      <span aria-hidden="true">·</span>
      <span>ENU-Tech · A동 606호</span>
    </footer>
  );
}
