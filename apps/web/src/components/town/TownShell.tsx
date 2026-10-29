'use client';

import type { ManualStatusDto, MeDto } from '@enu/shared';
import { formatLocalHm } from '@enu/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AvatarSprite } from '@/components/sprites';
import type { TownDirectory } from '@/game/directory';
import type { EventBus } from '@/game/EventBus';
import { RAIL_PX, TOP_BAR_PX } from '@/game/logic/camera';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import type { ConnectionStatus } from '@/realtime/types';
import { useDmUnread, useOfficeOpen, usePet, useRoster } from '@/realtime/useRealtime';
import { api, sendJson } from './api';
import { AvatarContextMenu } from './AvatarContextMenu';
import { ChatDock } from './ChatDock';
import { ConnectionBanner } from './ConnectionBanner';
import { DmDrawer } from './DmDrawer';
import { GroupPopover } from './GroupPopover';
import { useNow } from './hooks';
import { HoverCard } from './HoverCard';
import { Legend } from './Legend';
import { MyPetPanel } from './MyPetPanel';
import { PastChatsPanel } from './PastChatsPanel';
import { PeopleDirectory } from './PeopleDirectory';
import { PetBubbleActions, PetBubbleLiveRegion } from './PetBubble';
import { ProfileCard } from './ProfileCard';
import { StatusMenu } from './StatusMenu';
import { Toasts, type ToastItem } from './Toasts';
import {
  TownContext,
  type MyStatusState,
  type Popover,
  type Sheet,
  type TownContextValue,
  type TownUi,
} from './TownContext';
import { activeManual, currentChoice, onlineCount, statusChipLabel } from './townModel';
import { WorkLogPanel } from './WorkLogPanel';
import { WorkRequestMenu } from './WorkRequestMenu';
import s from './town.module.css';

/** At this width the team list is a docked right rail (and the chat lives in it); below, a sheet. */
const RAIL_MEDIA = '(min-width: 1280px)';
const RAIL_PREF_KEY = 'enu-town:rail-hidden';

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

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function readRailHidden(): boolean {
  try {
    return window.localStorage.getItem(RAIL_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRailHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(RAIL_PREF_KEY, '1');
    else window.localStorage.removeItem(RAIL_PREF_KEY);
  } catch {
    /* storage unavailable: the rail simply opens again next time */
  }
}

/**
 * React layer over the canvas: top bar (접속 N명, DM, my pet, my status chip, /me; zoom −/전체 보기/+ and
 * the legend), the docked team rail with the chat, side sheets, popovers, the hover card, toasts and
 * banners (connection, after-hours night). Owns the overlay UI state and wires Phaser <-> React events.
 * Nothing here moves an avatar.
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
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [textFocused, setTextFocused] = useState(false);
  const [hover, setHover] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [camera, setCamera] = useState<{ zoom: number; fit: number; atFit: boolean }>({
    zoom: 1,
    fit: 1,
    atFit: true,
  });
  const [manual, setManual] = useState<ManualStatusDto | null>(me.manualStatus);
  const [statusText, setStatusText] = useState(me.statusText ?? '');
  const wide = useMedia(RAIL_MEDIA);
  const [railHidden, setRailHidden] = useState(false);
  const docked = wide && !railHidden;
  const toastSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<Sheet | null>(null);
  const wideRef = useRef(wide);
  useEffect(() => {
    sheetRef.current = sheet;
    wideRef.current = wide;
  });

  useEffect(() => setRailHidden(readRailHidden()), []);

  const roster = useRoster(session);
  const unread = useDmUnread(session);
  const myPet = usePet(session, me.userId);
  const officeOpen = useOfficeOpen(session);
  const now = useNow();
  const myPlayer = roster.find((p) => p.id === me.userId);

  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
  }, []);

  const setRail = useCallback((hidden: boolean) => {
    setRailHidden(hidden);
    writeRailHidden(hidden);
  }, []);

  const anchorBelow = useCallback((selector: string, fallback: { x: number; y: number }) => {
    const root = rootRef.current?.getBoundingClientRect();
    const btn = rootRef.current?.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    return btn && root ? { x: btn.right - root.left, y: btn.bottom - root.top + 6 } : fallback;
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
        if (wideRef.current) {
          setRail(false);
          setSheet((cur) => (cur?.kind === 'people' ? null : cur));
        } else {
          setSheet({ kind: 'people' });
        }
      },
      openMyPet: () => {
        setPopover(null);
        setSheet({ kind: 'myPet' });
      },
      openStatus: (x, y) => {
        const a =
          x !== undefined && y !== undefined ? { x, y } : anchorBelow('[data-town-me]', { x: 300, y: 60 });
        setPopover({ kind: 'status', x: a.x, y: a.y });
      },
      openBubble: (bubbleId, x, y) => setPopover({ kind: 'bubble', bubbleId, x, y }),
      openGroup: (groupId, x, y) => setPopover({ kind: 'group', groupId, x, y }),
      openLegend: () => {
        const a = anchorBelow('[data-town-legend]', { x: 400, y: 60 });
        setPopover({ kind: 'legend', x: a.x, y: a.y });
      },
      viewUser: (userId) => {
        setPopover(null);
        bus.emit('camera:view-user', { userId });
      },
      closeSheet: () => setSheet(null),
      closePopover: () => setPopover(null),
      toast,
    }),
    [toast, bus, setRail, anchorBelow],
  );

  const myStatus: MyStatusState = useMemo(
    () => ({
      manual,
      text: statusText,
      set: (next) => {
        if (next.manual !== undefined) setManual(next.manual);
        if (next.text !== undefined) setStatusText(next.text);
      },
    }),
    [manual, statusText],
  );

  const ctx: TownContextValue = useMemo(
    () => ({ me, session, bus, directory, ui, myStatus }),
    [me, session, bus, directory, ui, myStatus],
  );

  // The camera fits the overview into the canvas minus the top bar and the docked rail (spec §5.2).
  useEffect(() => {
    const emit = () =>
      bus.emit('camera:insets', { top: TOP_BAR_PX, right: docked ? RAIL_PX : 0, bottom: 0, left: 0 });
    emit();
    const off = bus.on('game:ready', emit);
    if (docked) setSheet((cur) => (cur?.kind === 'people' ? null : cur));
    return off;
  }, [bus, docked]);

  // Phaser -> React
  useEffect(() => {
    const offs = [
      bus.on('entity:clicked', ({ userId, screenX, screenY }) => {
        setHover(null);
        if (userId === me.userId) ui.openStatus(screenX, screenY);
        else ui.openMenu(userId, screenX, screenY);
      }),
      bus.on('entity:view', () => setPopover((p) => (p?.kind === 'menu' || p?.kind === 'status' ? null : p))),
      bus.on('entity:hover', ({ userId, screenX, screenY }) =>
        setHover(userId ? { userId, x: screenX, y: screenY } : null),
      ),
      bus.on('group:clicked', ({ groupId, screenX, screenY }) => {
        setHover(null);
        ui.openGroup(groupId, screenX, screenY);
      }),
      bus.on('camera:changed', (c) => setCamera(c)),
      bus.on('pet:clicked', () => ui.openMyPet()),
      bus.on('pet:bubble-clicked', ({ bubbleId, screenX, screenY }) =>
        ui.openBubble(bubbleId, screenX, screenY),
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [bus, ui, me.userId]);

  // Realtime notices -> toasts
  useEffect(() => {
    const t = ko.townUi.toast;
    const nameOf = (id: string) => session.getPlayer(id)?.name || directory.person(id)?.displayName || '';
    const offs = [
      session.on('notice', (m) => {
        if (m.kind === 'work_log_published' && m.logId) {
          const logId = m.logId;
          toast({
            text: t.workLogPublished,
            ttlMs: 15_000,
            actions: [
              { label: t.view, onClick: () => router.push(`/me?log=${encodeURIComponent(logId)}`) },
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
          actions: [{ label: t.openDm, onClick: () => ui.openDm(m.fromUserId) }],
        });
      }),
      // Everyone sees a wave's arc on the map; only its target also gets a toast.
      session.on('emote', (m) => {
        if (m.kind !== 'wave' || m.toUserId !== me.userId || m.fromUserId === me.userId) return;
        toast({ text: t.waved(nameOf(m.fromUserId)), ttlMs: 3500 });
      }),
      session.on('server:error', (e) => {
        if (
          e.code === 'RATE_LIMITED' &&
          (e.type === 'social:ping' || e.type === 'social:wave' || e.type === 'status:set')
        ) {
          toast({ text: t.rateLimited, ttlMs: 3000, tone: 'warn' });
        } else if (e.type === 'social:ping' && e.code === 'NOT_ONLINE') {
          toast({ text: t.notOnline, ttlMs: 3000, tone: 'warn' });
        } else if (e.type === 'social:wave' && e.code === 'NOT_SHOWN') {
          toast({ text: t.notShown, ttlMs: 3000, tone: 'warn' });
        } else if (e.type === 'status:set' && e.code === 'INTERNAL') {
          toast({ text: t.statusFailed, ttlMs: 4000, tone: 'warn' });
        }
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
  }, [session, toast, ui, me.userId, directory, router]);

  // Typing in the overlays counts as busy for the pet (bubbles wait); it never affects the map.
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      if (isEditable(e.target)) setTextFocused(true);
    };
    const onOut = (e: FocusEvent) => {
      if (isEditable(e.target) && !isEditable(e.relatedTarget)) setTextFocused(false);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  // Presence: busy while a panel/menu is open or the user is typing (nudges wait).
  const uiBusy = sheet !== null || popover !== null || textFocused;
  useEffect(() => {
    session.setPresence({ uiBusy });
  }, [session, uiBusy]);

  const linkState = linkStateFromCode(myPet?.linkState, me.linkState);
  const tb = ko.townUi.topBar;
  const online = onlineCount(roster);
  const mine = currentChoice(myPlayer, officeOpen, activeManual(manual, now));
  const chip = statusChipLabel(mine.choice, mine.until, (ms) =>
    formatLocalHm(new Date(ms), me.officeTimeZone),
  );
  const peopleOpen = docked || sheet?.kind === 'people';

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
              aria-pressed={peopleOpen}
              onClick={() => {
                if (wide) setRail(!railHidden);
                else if (sheet?.kind === 'people') ui.closeSheet();
                else ui.openPeople();
              }}
            >
              <span className={s.hideSm}>{tb.people}</span>
              <span className={s.onlineCount}>
                <span className={s.onlineDot} aria-hidden="true" />
                {tb.online(online)}
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
              <span className={s.hideXs}>{tb.myPet}</span>
              <span className="visually-hidden">{tb.petBadge(ko.linkState[linkState])}</span>
            </button>
            <button
              type="button"
              className={s.pill}
              data-town-me
              aria-haspopup="dialog"
              aria-expanded={popover?.kind === 'status'}
              aria-label={`${tb.myStatus}: ${tb.statusChip(chip)}`}
              onClick={() => (popover?.kind === 'status' ? ui.closePopover() : ui.openStatus())}
            >
              <span className={s.miniAvatar}>
                <AvatarSprite preset={me.avatar} scale={1} label={me.displayName} />
              </span>
              <span className={s.hideSm}>{tb.statusChip(chip)}</span>
            </button>
            <Link className={s.pill} href="/me">
              <span className={s.hideXs}>{tb.me}</span>
              <span className={s.showXs} aria-hidden="true">
                ⚙
              </span>
            </Link>
          </div>
          <div className={`${s.pillGroup} ${s.zoomGroup}`}>
            <button
              type="button"
              className={`${s.pill} ${s.iconPill}`}
              aria-label={tb.zoomOut}
              title={tb.zoomOut}
              onClick={() => bus.emit('camera:zoom', { delta: -1 })}
            >
              −
            </button>
            <button
              type="button"
              className={s.pill}
              disabled={camera.atFit}
              onClick={() => bus.emit('camera:zoom', { delta: 0 })}
            >
              {tb.overview}
            </button>
            <button
              type="button"
              className={`${s.pill} ${s.iconPill}`}
              aria-label={tb.zoomIn}
              title={tb.zoomIn}
              onClick={() => bus.emit('camera:zoom', { delta: 1 })}
            >
              +
            </button>
            <button
              type="button"
              className={`${s.pill} ${s.iconPill}`}
              data-town-legend
              aria-label={tb.legend}
              title={tb.legend}
              aria-expanded={popover?.kind === 'legend'}
              onClick={() => (popover?.kind === 'legend' ? ui.closePopover() : ui.openLegend())}
            >
              ?
            </button>
          </div>
        </div>

        <div className={`${s.banners} ${docked ? s.bannersDocked : ''}`}>
          {officeOpen === false && (
            <div className={s.nightBanner} role="status">
              <span aria-hidden="true">☾</span>
              {ko.townUi.night.banner}
            </div>
          )}
          <ConnectionBanner status={status} session={session} />
        </div>

        {docked ? (
          <aside className={s.rail}>
            <PeopleDirectory docked onHide={() => setRail(true)} />
            <ChatDock docked />
          </aside>
        ) : (
          <ChatDock />
        )}

        {sheet?.kind === 'profile' && <ProfileCard key={sheet.userId} userId={sheet.userId} />}
        {sheet?.kind === 'worklog' && <WorkLogPanel key={sheet.userId} userId={sheet.userId} />}
        {sheet?.kind === 'pastChats' && (
          <PastChatsPanel key={`${sheet.userId}:${sheet.tab}`} userId={sheet.userId} initialTab={sheet.tab} />
        )}
        {sheet?.kind === 'people' && !docked && <PeopleDirectory />}
        {sheet?.kind === 'myPet' && <MyPetPanel />}
        {sheet?.kind === 'dm' && (
          <DmDrawer key={sheet.draftNonce} peerId={sheet.peerId} draft={sheet.draft} />
        )}

        {popover?.kind === 'menu' && (
          <AvatarContextMenu
            key={`${popover.userId}:${popover.x}:${popover.y}`}
            userId={popover.userId}
            x={popover.x}
            y={popover.y}
          />
        )}
        {popover?.kind === 'workRequest' && (
          <WorkRequestMenu userId={popover.userId} x={popover.x} y={popover.y} />
        )}
        {popover?.kind === 'status' && <StatusMenu x={popover.x} y={popover.y} />}
        {popover?.kind === 'bubble' && (
          <PetBubbleActions bubbleId={popover.bubbleId} x={popover.x} y={popover.y} />
        )}
        {popover?.kind === 'group' && (
          <GroupPopover key={popover.groupId} groupId={popover.groupId} x={popover.x} y={popover.y} />
        )}
        {popover?.kind === 'legend' && <Legend x={popover.x} y={popover.y} />}

        {hover && popover === null && <HoverCard userId={hover.userId} x={hover.x} y={hover.y} />}

        <Toasts
          toasts={toasts}
          docked={docked}
          onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        />
        <PetBubbleLiveRegion />
      </div>
    </TownContext.Provider>
  );
}
