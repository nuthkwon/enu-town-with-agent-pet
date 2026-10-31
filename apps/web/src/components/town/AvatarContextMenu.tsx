'use client';

import { PlateNote } from '@enu/protocol';
import { teamLabel } from '@enu/shared';
import { teamColor } from '@/game/directory';
import { activityIcon } from '@/game/logic/presence';
import { ko } from '@/i18n/ko';
import { useOfficeOpen, useRoster } from '@/realtime/useRealtime';
import { Popover, onMenuKeyDown } from './Chrome';
import { EffectIcon } from './EffectIcon';
import { useDirectory } from './hooks';
import { useTown } from './TownContext';
import { SpellBar } from './SpellBar';
import { castState, menuState } from './townModel';
import s from './town.module.css';

/**
 * Menu for a colleague (clicked avatar, desk plate or team-rail row; spec §5.3):
 * 프로필 · 지금 하는 일 · 지난 대화 · 업무 요청 · DM 보내기 · ─ · 손 흔들기 (모두에게 보여요) · 부르기 · 이 사람 보기,
 * then the spellbook (마법 쓰기, public like the wave; ADR 0008).
 * Every roster member is always in the state: what is enabled depends on `shown`/`online`, never on
 * "a Player exists".
 */
export function AvatarContextMenu({ userId, x, y }: { userId: string; x: number; y: number }) {
  const { session, directory, ui, me } = useTown();
  useDirectory(directory);
  const roster = useRoster(session);
  const officeOpen = useOfficeOpen(session);
  const person = directory.person(userId);
  const player = roster.find((p) => p.id === userId);
  const mine = roster.find((p) => p.id === me.userId);
  const name = player?.name || person?.displayName || '';
  const state = menuState(player, mine, officeOpen, me.officeTimeZone);
  const cast = castState(player, mine, officeOpen, person);
  const icon = player && player.note === PlateNote.None ? activityIcon(player.activity) : null;
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
          <div className={s.popoverTitle}>
            {name}
            {state.online && (
              <span
                className={s.onlineDot}
                title={ko.townUi.people.online}
                aria-label={ko.townUi.people.online}
              />
            )}
          </div>
          <div className={s.popoverSub}>
            {[teamLabel(person?.team), person?.title].filter(Boolean).join(' · ')}
          </div>
          {state.form && (
            <div className={s.popoverState}>
              {icon && <EffectIcon name={icon} />}
              <span>{state.form}</span>
            </div>
          )}
        </div>
      </div>
      <div className={s.menu} onKeyDown={onMenuKeyDown}>
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          onClick={run(() => ui.openProfile(userId))}
          data-autofocus
        >
          <span className={s.menuIcon} aria-hidden="true">
            ☺
          </span>
          {t.profile}
        </button>
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          onClick={run(() => ui.openWorkLog(userId))}
        >
          <span className={s.menuIcon} aria-hidden="true">
            ✎
          </span>
          {t.now}
        </button>
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          onClick={run(() => ui.openPastChats(userId))}
        >
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
          disabled={!state.canWave}
          onClick={run(() => {
            if (session.wave(userId)) ui.toast({ text: t.waved(name), ttlMs: 2500, tone: 'success' });
          })}
        >
          <span className={s.menuIcon} aria-hidden="true">
            ♡
          </span>
          <span className={s.menuLabel}>
            {t.wave}
            <span className={s.menuNote}>{t.waveNote}</span>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          disabled={!state.canPing}
          onClick={run(() => {
            if (session.ping(userId)) ui.toast({ text: t.pinged(name), ttlMs: 2500, tone: 'success' });
          })}
        >
          <span className={s.menuIcon} aria-hidden="true">
            !
          </span>
          {t.ping}
        </button>
        <button
          type="button"
          role="menuitem"
          className={s.menuItem}
          disabled={!state.canView}
          onClick={run(() => ui.viewUser(userId))}
        >
          <span className={s.menuIcon} aria-hidden="true">
            ◎
          </span>
          {t.view}
        </button>
        {state.hint && <div className={s.menuHint}>{state.hint}</div>}
        <div className={s.menuSep} role="separator" />
        <div className={s.menuSection} aria-hidden="true">
          {ko.magic.menuTitle}
        </div>
        <SpellBar
          session={session}
          targetId={userId}
          disabledReason={cast.reason}
          onCast={() => ui.closePopover()}
          asMenuItems
        />
      </div>
    </Popover>
  );
}
