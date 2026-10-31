'use client';

import type { DmThreadDto } from '@enu/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SoundToggle } from '@/components/SoundToggle';
import { PetSprite } from '@/components/sprites';
import { ConnectionBanner } from '@/components/town/ConnectionBanner';
import { useDirectory, useTextFocus } from '@/components/town/hooks';
import { useSessionNotices, type NoticeCtx } from '@/components/town/notices';
import { Toasts, type ToastItem } from '@/components/town/Toasts';
import type { ToastInput } from '@/components/town/TownContext';
import { Button, cx } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch } from '@/lib/api';
import { useDmUnread, useRoster } from '@/realtime/useRealtime';
import { useSessionSfx } from '@/sound/useSessionSfx';
import { useDen } from './DenProvider';
import s from './den.module.css';
import { OverviewDialog } from './overview/OverviewDialog';
import { OverviewFeed } from './overview/OverviewFeed';
import { TownCanvas } from './overview/TownCanvas';
import { useOverview, type OverviewState } from './overview/useOverview';

function useWide(minPx: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minPx}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [minPx]);
  return wide;
}

type Drawer = 'nav' | 'town' | null;

/**
 * The messenger: the list of my pets, rooms and colleagues; the conversation; and the town, a panel that nobody
 * steers (a drawer below 1280 px, a tab below 768 px), with the work feed under it (ADR 0007). 크게 보기 opens the
 * overview popup. The town canvas is mounted only while it is visible, and in one place at a time.
 */
export function DenShell({ children }: { children: ReactNode }) {
  const { me, session, status, directory } = useDen();
  const pathname = usePathname();
  const router = useRouter();
  const wide = useWide(1280);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const t = ko.den;

  // A navigation closes the mobile list, the town drawer and the overview popup.
  useEffect(() => {
    setDrawer(null);
    setOverviewOpen(false);
  }, [pathname]);

  // Typing anywhere in the messenger, or the overview popup, counts as busy for my pet's town bubbles
  // (owner-only scheduler input).
  const typing = useTextFocus();
  useEffect(() => {
    session.setPresence({ uiBusy: typing || overviewOpen });
  }, [session, typing, overviewOpen]);

  // Calls, waves, spells and DMs reach someone who keeps only the messenger open too (toasts and sounds).
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const toast = useCallback((t: ToastInput) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
  }, []);
  const noticeCtx: NoticeCtx = useMemo(
    () => ({
      meId: me.userId,
      nameOf: (id) => session.getPlayer(id)?.name || directory.person(id)?.displayName || '',
      viewingDm: (peerId) => session.getActiveDmPeer() === peerId,
      openDm: (peerId) => router.push(`/dm/${encodeURIComponent(peerId)}`),
      openLog: (logId) => router.push(`/me?log=${encodeURIComponent(logId)}`),
      makeLogPrivate: async (logId) => {
        await apiFetch(`/api/v1/me/work-logs/${encodeURIComponent(logId)}`, {
          method: 'PATCH',
          body: { visibility: 'private' },
        });
        toast({ text: ko.townUi.toast.madePrivate, ttlMs: 3000, tone: 'success' });
      },
    }),
    [me.userId, session, directory, router, toast],
  );
  useSessionNotices(session, noticeCtx, toast);
  useSessionSfx(session, me.userId);

  const townVisible = wide || drawer === 'town';
  const overview = useOverview(session, townVisible || overviewOpen);
  // The overview popup is modal (the top layer covers the page and makes it inert): while it is open the toasts
  // go inside it, at the same place, so they stay visible, clickable and announced.
  const toastStack = (
    <Toasts
      toasts={toasts}
      className={s.denToasts}
      onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
    />
  );
  return (
    <div className={s.shell}>
      <DenNav open={drawer === 'nav'} />
      <main id="main" className={s.main}>
        {/* 768-1279 px: the town is a drawer, opened from this bar (in the flow, so it never covers a page). */}
        {!wide && (
          <div className={s.mainBar}>
            <TownToggle onOpen={() => setDrawer('town')} />
          </div>
        )}
        <ConnectionBanner status={status} session={session} />
        {children}
      </main>
      <aside
        className={cx(s.town, drawer === 'town' && s.townOpen)}
        aria-label={t.town.label}
        hidden={!townVisible}
      >
        {townVisible && (
          <TownPanel
            overview={overview}
            expanded={overviewOpen}
            onExpand={() => {
              // Opening the popup also fetches the overview again (untimed changes are pushed only in batches).
              overview.retry();
              setOverviewOpen(true);
            }}
            onClose={wide ? null : () => setDrawer(null)}
          />
        )}
      </aside>
      {overviewOpen ? (
        <OverviewDialog overview={overview} toasts={toastStack} onClose={() => setOverviewOpen(false)} />
      ) : (
        toastStack
      )}
      <nav className={s.tabbar} aria-label={t.nav.tabsLabel}>
        <button
          type="button"
          className={s.tab}
          aria-pressed={drawer === 'nav'}
          onClick={() => setDrawer(drawer === 'nav' ? null : 'nav')}
        >
          {t.nav.tabs.chats}
        </button>
        <button
          type="button"
          className={s.tab}
          aria-pressed={drawer === 'town'}
          onClick={() => setDrawer(drawer === 'town' ? null : 'town')}
        >
          {t.nav.tabs.town}
        </button>
        <Link
          className={s.tab}
          href="/settings/pets"
          aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
        >
          {t.nav.tabs.settings}
        </Link>
        <Link className={s.tab} href="/me">
          {t.nav.myInfo}
        </Link>
      </nav>
    </div>
  );
}

/** Opens the town drawer between 768 and 1279 px (the tab bar does it below 768 px). */
function TownToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <Button size="sm" variant="secondary" onClick={onOpen}>
      {ko.den.town.show}
    </Button>
  );
}

function TownPanel({
  overview,
  expanded,
  onExpand,
  onClose,
}: {
  overview: OverviewState;
  /** The popup shows the town: only a placeholder here (one Phaser game at a time). */
  expanded: boolean;
  onExpand: () => void;
  onClose: (() => void) | null;
}) {
  const t = ko.den.town;
  return (
    <>
      <div className={s.townBar}>
        <span title={t.hint}>{t.label}</span>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t.hide}
          </Button>
        )}
      </div>
      {expanded ? (
        <div className={s.townCanvas}>
          <div className={s.townMessage}>{ko.den.overview.townBusy}</div>
        </div>
      ) : (
        <TownCanvas />
      )}
      <section className={s.townFeed} aria-labelledby="den-overview-title">
        <div className={s.townFeedBar}>
          <h2 id="den-overview-title" className={s.townFeedTitle} title={ko.den.overview.lead}>
            {ko.den.overview.title}
          </h2>
          <Button size="sm" variant="secondary" onClick={onExpand} aria-haspopup="dialog">
            {ko.den.overview.expand}
          </Button>
        </div>
        <div className={s.townFeedScroll}>
          <OverviewFeed state={overview} variant="compact" />
        </div>
      </section>
    </>
  );
}

function DenNav({ open }: { open: boolean }) {
  const { me, pets, session, directory } = useDen();
  const pathname = usePathname();
  const roster = useRoster(session);
  const dmUnread = useDmUnread(session);
  const { people } = useDirectory(directory);
  const [threads, setThreads] = useState<DmThreadDto[]>([]);
  const [dmTick, setDmTick] = useState(0);
  const t = ko.den.nav;

  // Any DM, sent or received, can start a thread or change its last line.
  useEffect(() => session.on('dm:msg', () => setDmTick((n) => n + 1)), [session]);
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<DmThreadDto[]>('/api/v1/dm/threads', { signal: ctrl.signal })
      .then((list) => setThreads(list ?? []))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [dmUnread.total, dmTick]);

  const online = useMemo(() => new Set(roster.filter((p) => p.online).map((p) => p.id)), [roster]);
  const colleagues = people.filter((p) => p.userId !== me.userId);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className={cx(s.nav, open && s.navOpen)} aria-label={t.label}>
      <div className={s.navHead}>
        <Link href="/" className={s.brand}>
          {ko.den.title}
        </Link>
        <SoundToggle className={s.soundButton} />
      </div>
      <div className={s.navScroll}>
        <section className={s.navSection} aria-labelledby="den-nav-pets">
          <h2 id="den-nav-pets" className={s.navTitle}>
            {t.myPets}
          </h2>
          <ul className={s.navList}>
            {(pets ?? []).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pets/${p.id}`}
                  className={cx(s.navItem, active(`/pets/${p.id}`) && s.navItemActive)}
                  aria-current={active(`/pets/${p.id}`) ? 'page' : undefined}
                >
                  <PetSprite species={p.species} tint={p.tint} scale={1.5} label={p.name} />
                  <span className={s.navText}>
                    <span className={s.navName}>{p.name}</span>
                    <span className={s.navLast}>{p.pendingCount > 0 ? t.waiting : (p.last?.text ?? '')}</span>
                  </span>
                  {p.unread > 0 && (
                    <span className={s.count} aria-label={t.unread(p.unread)}>
                      {p.unread}
                    </span>
                  )}
                </Link>
              </li>
            ))}
            {pets && pets.length < 5 && (
              <li>
                <Link href="/pets/new" className={cx(s.navItem, active('/pets/new') && s.navItemActive)}>
                  <span aria-hidden="true">＋</span>
                  <span className={s.navName}>{t.newPet}</span>
                </Link>
              </li>
            )}
          </ul>
        </section>

        <section className={s.navSection} aria-labelledby="den-nav-rooms">
          <h2 id="den-nav-rooms" className={s.navTitle}>
            {t.rooms}
          </h2>
          <ul className={s.navList}>
            <li>
              <Link href="/all" className={cx(s.navItem, active('/all') && s.navItemActive)}>
                <span className={s.navName}>{t.all}</span>
              </Link>
            </li>
            {/* Only active colleagues: a deactivated person's DM page does not exist any more. */}
            {threads
              .filter((th) => people.some((p) => p.userId === th.peerId))
              .map((th) => {
                const unread = dmUnread.byPeer[th.peerId] ?? 0;
                return (
                  <li key={th.peerId}>
                    <Link
                      href={`/dm/${th.peerId}`}
                      className={cx(s.navItem, active(`/dm/${th.peerId}`) && s.navItemActive)}
                    >
                      <span className={s.navText}>
                        <span className={s.navName}>{th.peerName}</span>
                        <span className={s.navLast}>{th.lastText}</span>
                      </span>
                      {unread > 0 && <span className={s.count}>{unread}</span>}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>

        <section className={s.navSection} aria-labelledby="den-nav-people">
          <h2 id="den-nav-people" className={s.navTitle}>
            {t.people}
          </h2>
          <ul className={s.navList}>
            {colleagues.map((p) => (
              <li key={p.userId}>
                <Link
                  href={`/people/${p.userId}`}
                  className={cx(s.navItem, active(`/people/${p.userId}`) && s.navItemActive)}
                >
                  <span className={cx(s.dot, online.has(p.userId) && s.dotOn)} aria-hidden="true" />
                  <span className={s.navText}>
                    <span className={s.navName}>{p.displayName}</span>
                    <span className={s.navLast}>{p.teamLabel}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className={s.navFoot}>
        <Link href="/settings/pets">{t.petSettings}</Link>
        <Link href="/me">{t.myInfo}</Link>
        <Link href="/town">{t.townFull}</Link>
      </div>
    </nav>
  );
}
