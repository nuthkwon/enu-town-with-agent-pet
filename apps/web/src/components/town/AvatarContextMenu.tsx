'use client';

import { STATUS_LABEL_KO, type Status } from '@enu/protocol';
import { teamLabel } from '@enu/shared';
import { ko } from '@/i18n/ko';
import { teamColor } from '@/game/directory';
import { useRoster } from '@/realtime/useRealtime';
import { Popover, onMenuKeyDown } from './Chrome';
import { useDirectory } from './hooks';
import { useTown } from './TownContext';
import s from './town.module.css';

/**
 * Menu for a colleague (clicked avatar, offline desk, or people list):
 * 프로필 · 지금 하는 일 · 지난 대화 · 업무 요청 · DM 보내기 · 손 흔들기 · 부르기.
 */
export function AvatarContextMenu({ userId, x, y }: { userId: string; x: number; y: number }) {
  const { session, directory, ui, bus } = useTown();
  useDirectory(directory);
  const roster = useRoster(session);
  const person = directory.person(userId);
  const player = roster.find((p) => p.id === userId);
  const name = player?.name || person?.displayName || '';
  const online = player !== undefined;
  const t = ko.townUi.menu;

  const run = (fn: () => void) => () => {
    ui.closePopover();
    fn();
  };

  return (
    <Popover x={x} y={y} onClose={ui.closePopover} label={t.label(name)} role="menu">
      <div className={s.popoverHeader}>
        <span className={s.teamSwatch} style={{ background: teamColor(person?.team) }} aria-hidden="true" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={s.popoverTitle}>{name}</div>
          <div className={s.popoverSub}>
            {[teamLabel(person?.team), person?.title].filter(Boolean).join(' · ')}
            {' · '}
            {online ? STATUS_LABEL_KO[(player?.status ?? 0) as Status] ?? '' : t.offline}
          </div>
        </div>
      </div>
      <div className={s.menu} onKeyDown={onMenuKeyDown}>
        <button type="button" role="menuitem" className={s.menuItem} onClick={run(() => ui.openProfile(userId))} data-autofocus>
          <span className={s.menuIcon} aria-hidden="true">
            ☺
          </span>
          {t.profile}
        </button>
        <button type="button" role="menuitem" className={s.menuItem} onClick={run(() => ui.openWorkLog(userId))}>
          <span className={s.menuIcon} aria-hidden="true">
            ✎
          </span>
          {t.now}
        </button>
        <button type="button" role="menuitem" className={s.menuItem} onClick={run(() => ui.openPastChats(userId))}>
          <span className={s.menuIcon} aria-hidden="true">
            ☰
          </span>
          {t.pastChats}
        </button>
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          onClick={() => ui.openWorkRequest(userId, x, y)}
          aria-haspopup="menu"
        >
          <span className={s.menuIcon} aria-hidden="true">
            ✉
          </span>
          {t.workRequest}
        </button>
        <button type="button" role="menuitem" className={s.menuItem} onClick={run(() => ui.openDm(userId))}>
          <span className={s.menuIcon} aria-hidden="true">
            ✦
          </span>
          {t.dm}
        </button>
        <div className={s.menuSep} role="separator" />
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          disabled={!online}
          onClick={run(() => {
            if (session.wave()) ui.toast({ text: t.waved(name), ttlMs: 2500, tone: 'success' });
          })}
        >
          <span className={s.menuIcon} aria-hidden="true">
            ♡
          </span>
          {t.wave}
        </button>
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          disabled={!online}
          onClick={run(() => {
            if (session.ping(userId)) ui.toast({ text: t.pinged(name), ttlMs: 2500, tone: 'success' });
          })}
        >
          <span className={s.menuIcon} aria-hidden="true">
            !
          </span>
          {t.ping}
        </button>
        {online && (
          <button type="button" role="menuitem" className={s.menuItem} onClick={run(() => bus.emit('move:to-user', { userId }))}>
            <span className={s.menuIcon} aria-hidden="true">
              ➜
            </span>
            {t.walkTo}
          </button>
        )}
        {!online && <div className={s.menuHint}>{t.offlineAction}</div>}
      </div>
    </Popover>
  );
}
