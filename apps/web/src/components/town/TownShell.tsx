'use client';

import { STATUS_LABEL_KO, type Status } from '@enu/protocol';
import type { MeDto } from '@enu/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvatarSprite } from '@/components/sprites';
import type { TownDirectory } from '@/game/directory';
import type { EventBus } from '@/game/EventBus';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import type { ConnectionStatus } from '@/realtime/types';
import { useDmUnread, usePet, useRoster } from '@/realtime/useRealtime';
import { api, sendJson } from './api';
import { AvatarContextMenu } from './AvatarContextMenu';
import { ChatDock } from './ChatDock';
import { ConnectionBanner } from './ConnectionBanner';
import { DmDrawer } from './DmDrawer';
import { MyPetPanel } from './MyPetPanel';
import { PastChatsPanel } from './PastChatsPanel';
import { PeopleDirectory } from './PeopleDirectory';
import { PetBubbleActions, PetBubbleLiveRegion } from './PetBubble';
import { ProfileCard } from './ProfileCard';
import { StatusMenu } from './StatusMenu';
import { Toasts, type ToastItem } from './Toasts';
import { TownContext, type Popover, type Sheet, type TownContextValue, type TownUi } from './TownContext';
import { WorkLogPanel } from './WorkLogPanel';
import { WorkRequestMenu } from './WorkRequestMenu';
import s from './town.module.css';

function isEditable(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

function linkStateFromCode(code: number | undefined, fallback: MeDto['linkState']): MeDto['linkState'] {
  if (code === 0) return 'linked';
  if (code === 2) return 'stale';
  if (code === 1) return 'not_linked';
  return fallback;
}

/**
 * React layer over the canvas: top bar (my status, people, DM, my pet, /me), chat dock, side sheets,
 * popovers, toasts and banners. Owns the overlay UI state and wires Phaser <-> React events.
 */
export function TownShell({
  me,
  session,
  bus,
  directory,
  status,
}: {
  me: MeDto;
  session: RealtimeSession;
  bus: EventBus;
  directory: TownDirectory;
  status: ConnectionStatus;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [textFocused, setTextFocused] = useState(false);
  const toastSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<Sheet | null>(null);
  useEffect(() => {
    sheetRef.current = sheet;
  });

  const roster = useRoster(session);
  const unread = useDmUnread(session);
  const myPet = usePet(session, me.userId);
  const myPlayer = roster.find((p) => p.id === me.userId);

  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
  }, []);

  const ui: TownUi = useMemo(
    () => ({
      openMenu: (userId, x, y) => setPopover({ kind: 'menu', userId, x, y }),
      openProfile: (userId) => {
        setPopover(null);
        setSheet({ kind: 'profile', userId });
      },
      openWorkLog: (userId) => {
        setPopover(null);
        setSheet({ kind: 'worklog', userId });
      },
      openPastChats: (userId, tab = 'dm') => {
        setPopover(null);
        setSheet({ kind: 'pastChats', userId, tab });
      },
      openWorkRequest: (userId, x, y) => setPopover({ kind: 'workRequest', userId, x, y }),
      openDm: (peerId, draft = null) => {
        setPopover(null);
        setSheet({ kind: 'dm', peerId, draft: draft ?? null, draftNonce: Date.now() });
      },
      openPeople: () => {
        setPopover(null);
        setSheet({ kind: 'people' });
      },
      openMyPet: () => {
        setPopover(null);
        setSheet({ kind: 'myPet' });
      },
      openStatus: (x, y) => {
        const root = rootRef.current?.getBoundingClientRect();
        const btn = rootRef.current?.querySelector<HTMLElement>('[data-town-me]')?.getBoundingClientRect();
        setPopover({
          kind: 'status',
          x: x ?? (btn && root ? btn.right - root.left : 300),
          y: y ?? (btn && root ? btn.bottom - root.top + 6 : 60),
        });
      },
      openBubble: (bubbleId, x, y) => setPopover({ kind: 'bubble', bubbleId, x, y }),
      closeSheet: () => setSheet(null),
      closePopover: () => setPopover(null),
      toast,
    }),
    [toast],
  );

  const ctx: TownContextValue = useMemo(() => ({ me, session, bus, directory, ui }), [me, session, bus, directory, ui]);

  // Phaser -> React
  useEffect(() => {
    const offs = [
      bus.on('entity:clicked', ({ userId, screenX, screenY }) => {
        if (userId === me.userId) ui.openStatus(screenX, screenY);
        else ui.openMenu(userId, screenX, screenY);
      }),
      bus.on('pet:clicked', () => ui.openMyPet()),
      bus.on('pet:bubble-clicked', ({ bubbleId, screenX, screenY }) => ui.openBubble(bubbleId, screenX, screenY)),
      bus.on('move:unreachable', () => toast({ text: ko.townUi.unreachable, ttlMs: 2000 })),
    ];
    return () => offs.forEach((off) => off());
  }, [bus, ui, me.userId, toast]);

  // Realtime notices -> toasts
  useEffect(() => {
    const t = ko.townUi.toast;
    const offs = [
      session.on('notice', (m) => {
        if (m.kind === 'work_log_published' && m.logId) {
          const logId = m.logId;
          toast({
            text: t.workLogPublished,
            ttlMs: 15_000,
            actions: [
              { label: t.view, onClick: () => window.location.assign(`/me?log=${encodeURIComponent(logId)}`) },
              {
                label: t.makePrivate,
                onClick: async () => {
                  await sendJson('PATCH', api.myWorkLog(logId), { visibility: 'private' });
                  toast({ text: t.madePrivate, ttlMs: 3000, tone: 'success' });
                },
              },
            ],
          });
        } else if (m.text) {
          toast({ text: m.text, ttlMs: 8000 });
        }
      }),
      session.on('pinged', (m) => {
        toast({
          text: t.pinged(m.fromName),
          ttlMs: 12_000,
          actions: [{ label: t.goTo, onClick: () => bus.emit('move:to-user', { userId: m.fromUserId }) }],
        });
      }),
      session.on('emote', (m) => {
        if (m.fromUserId === me.userId || m.kind !== 'wave') return;
        const name = session.getPlayer(m.fromUserId)?.name ?? directory.person(m.fromUserId)?.displayName ?? '';
        toast({ text: t.waved(name), ttlMs: 3000 });
      }),
      session.on('dm:msg', (m) => {
        if (m.fromUserId === me.userId) return;
        const open = sheetRef.current;
        if (open?.kind === 'dm' && open.peerId === m.fromUserId) return;
        toast({
          text: t.dmFrom(m.fromName),
          ttlMs: 8000,
          actions: [{ label: t.open, onClick: () => ui.openDm(m.fromUserId) }],
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [session, bus, toast, ui, me.userId, directory]);

  // Typing anywhere in the overlays pauses keyboard movement in the map.
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      if (isEditable(e.target)) {
        setTextFocused(true);
        bus.emit('ui:text-focus', { focused: true });
      }
    };
    const onOut = (e: FocusEvent) => {
      if (isEditable(e.target) && !isEditable(e.relatedTarget)) {
        setTextFocused(false);
        bus.emit('ui:text-focus', { focused: false });
      }
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, [bus]);

  // Presence: busy while a panel/menu is open or the user is typing (nudges wait).
  const uiBusy = sheet !== null || popover !== null || textFocused;
  useEffect(() => {
    session.setPresence({ uiBusy });
  }, [session, uiBusy]);

  const linkState = linkStateFromCode(myPet?.linkState, me.linkState);
  const myStatus = (myPlayer?.status ?? 0) as Status;
  const tb = ko.townUi.topBar;

  return (
    <TownContext.Provider value={ctx}>
      <div ref={rootRef} className={s.overlay} data-town-root>
        <div className={s.topBar}>
          <span className={s.brand}>
            <span className={s.brandMark} aria-hidden="true" />
            {ko.app.name}
            <span className={s.brandSub}>{ko.app.tagline}</span>
          </span>
          <span className={s.spacer} />
          <div className={s.pillGroup}>
            <button
              type="button"
              className={s.pill}
              aria-pressed={sheet?.kind === 'people'}
              onClick={() => (sheet?.kind === 'people' ? ui.closeSheet() : ui.openPeople())}
            >
              {tb.people}
              <span className={s.hideSm} aria-label={tb.online(roster.length)}>
                {roster.length}
              </span>
            </button>
            <button
              type="button"
              className={s.pill}
              aria-pressed={sheet?.kind === 'dm'}
              onClick={() => (sheet?.kind === 'dm' ? ui.closeSheet() : ui.openDm(null))}
            >
              {tb.dm}
              {unread.total > 0 && (
                <span className={s.countBadge} aria-label={tb.unread(unread.total)}>
                  {unread.total > 99 ? '99+' : unread.total}
                </span>
              )}
            </button>
            <button
              type="button"
              className={s.pill}
              aria-pressed={sheet?.kind === 'myPet'}
              onClick={() => (sheet?.kind === 'myPet' ? ui.closeSheet() : ui.openMyPet())}
              title={tb.petBadge(ko.linkState[linkState])}
            >
              <span className={`${s.linkDot} ${s[`link-${linkState}`]}`} aria-hidden="true" />
              {tb.myPet}
              <span className="visually-hidden">{tb.petBadge(ko.linkState[linkState])}</span>
            </button>
            <button
              type="button"
              className={s.pill}
              data-town-me
              aria-haspopup="dialog"
              aria-expanded={popover?.kind === 'status'}
              aria-label={`${tb.myStatus}: ${STATUS_LABEL_KO[myStatus]}`}
              onClick={() => (popover?.kind === 'status' ? ui.closePopover() : ui.openStatus())}
            >
              <span className={s.miniAvatar}>
                <AvatarSprite preset={me.avatar} scale={1} label={me.displayName} />
              </span>
              <span className={s.hideSm}>{me.displayName}</span>
              <span className={`${s.statusDot} ${s[`status-${myStatus}`]}`} aria-hidden="true" />
            </button>
            <Link className={s.pill} href="/me">
              {tb.me}
            </Link>
          </div>
          <div className={s.pillGroup}>
            <button
              type="button"
              className={`${s.pill} ${s.iconPill}`}
              aria-label={tb.zoomOut}
              onClick={() => bus.emit('camera:zoom', { delta: -1 })}
            >
              −
            </button>
            <button
              type="button"
              className={`${s.pill} ${s.iconPill}`}
              aria-label={tb.zoomIn}
              onClick={() => bus.emit('camera:zoom', { delta: 1 })}
            >
              +
            </button>
          </div>
        </div>

        <ConnectionBanner status={status} session={session} />
        <ChatDock />

        {sheet?.kind === 'profile' && <ProfileCard key={sheet.userId} userId={sheet.userId} />}
        {sheet?.kind === 'worklog' && <WorkLogPanel key={sheet.userId} userId={sheet.userId} />}
        {sheet?.kind === 'pastChats' && (
          <PastChatsPanel key={`${sheet.userId}:${sheet.tab}`} userId={sheet.userId} initialTab={sheet.tab} />
        )}
        {sheet?.kind === 'people' && <PeopleDirectory />}
        {sheet?.kind === 'myPet' && <MyPetPanel />}
        {sheet?.kind === 'dm' && <DmDrawer key={sheet.draftNonce} peerId={sheet.peerId} draft={sheet.draft} />}

        {popover?.kind === 'menu' && (
          <AvatarContextMenu key={`${popover.userId}:${popover.x}:${popover.y}`} userId={popover.userId} x={popover.x} y={popover.y} />
        )}
        {popover?.kind === 'workRequest' && <WorkRequestMenu userId={popover.userId} x={popover.x} y={popover.y} />}
        {popover?.kind === 'status' && <StatusMenu x={popover.x} y={popover.y} />}
        {popover?.kind === 'bubble' && <PetBubbleActions bubbleId={popover.bubbleId} x={popover.x} y={popover.y} />}

        <Toasts toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
        <PetBubbleLiveRegion />
      </div>
    </TownContext.Provider>
  );
}
