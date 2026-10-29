'use client';

import { manualStatusUntil } from '@enu/domain';
import { LIMITS, MANUAL_DURATIONS, formatLocalHm, type ManualDuration, type MeDto } from '@enu/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { EffectName } from '@/game/spriteSpec';
import { ko } from '@/i18n/ko';
import { useConnectionStatus, useOfficeOpen, useRoster } from '@/realtime/useRealtime';
import { api } from './api';
import { Popover } from './Chrome';
import { EffectIcon } from './EffectIcon';
import { useFetch, useNow } from './hooks';
import { useTown } from './TownContext';
import {
  DEFAULT_DURATION,
  STATUS_CHOICES,
  activeManual,
  currentChoice,
  ownHiddenLine,
  statusPayload,
  type StatusChoice,
} from './townModel';
import s from './town.module.css';

const CHOICE_ICON: Partial<Record<StatusChoice, EffectName>> = {
  available: 'check',
  focus: 'focus',
  meeting: 'headset',
  break: 'cup',
};

/**
 * 내 상태 (spec §5.5): 자동 + 5 statuses with a duration, the 상태 문구, how colleagues see me while I am
 * hidden, and the read-only list of today's blocks my own Claude sent (MeDto.activityToday).
 */
export function StatusMenu({ x, y }: { x: number; y: number }) {
  const { session, me, ui, myStatus } = useTown();
  const roster = useRoster(session);
  const officeOpen = useOfficeOpen(session);
  const conn = useConnectionStatus(session);
  const now = useNow();
  const fresh = useFetch<MeDto>(api.me());
  const mine = roster.find((p) => p.id === me.userId);
  const tz = me.officeTimeZone;
  const current = currentChoice(mine, officeOpen, activeManual(myStatus.manual, now));
  const [choice, setChoice] = useState<StatusChoice>(current.choice);
  const [duration, setDuration] = useState<ManualDuration>(DEFAULT_DURATION);
  const [text, setText] = useState<string>(myStatus.text);
  const t = ko.townUi.status;
  const connected = conn.kind === 'connected';
  const hiddenLine = ownHiddenLine(mine, officeOpen, tz);
  const hm = (iso: string) => formatLocalHm(new Date(iso), tz);

  const apply = (nextText: string) => {
    const msg = statusPayload(choice, duration, nextText, myStatus.text);
    if (!session.sendStatus(msg)) return;
    myStatus.set({
      manual:
        choice === 'auto'
          ? null
          : { status: choice, until: manualStatusUntil(new Date(), tz, duration).toISOString() },
      ...(msg.text !== undefined ? { text: msg.text } : {}),
    });
    ui.closePopover();
  };

  const today = fresh.data?.activityToday ?? null;
  const sharing = (fresh.data ?? me).shareActivity === true;

  return (
    <Popover x={x} y={y} onClose={ui.closePopover} label={t.title} anchor="below">
      <div className={s.statusMenu}>
        <div className={s.popoverHeader}>
          <div className={s.popoverTitle}>{t.title}</div>
        </div>
        {hiddenLine && <p className={s.hiddenLine}>{hiddenLine}</p>}
        {officeOpen === false && <p className={s.explain}>{t.closed}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(text);
          }}
        >
          <fieldset className={s.radioList}>
            <legend className="visually-hidden">{t.title}</legend>
            {STATUS_CHOICES.map((st) => {
              const icon = CHOICE_ICON[st];
              return (
                <label key={st} className={s.radio}>
                  <input
                    type="radio"
                    name="town-status"
                    value={st}
                    checked={choice === st}
                    onChange={() => setChoice(st)}
                    data-autofocus={choice === st ? true : undefined}
                  />
                  {icon ? <EffectIcon name={icon} /> : <span className={s.fxSpacer} aria-hidden="true" />}
                  {t.options[st]}
                </label>
              );
            })}
          </fieldset>
          {choice !== 'auto' && (
            <fieldset className={s.durationRow}>
              <legend className={s.label}>{t.durationLabel}</legend>
              {MANUAL_DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={s.durationChip}
                  aria-pressed={duration === d}
                  onClick={() => setDuration(d)}
                >
                  {t.durations[d]}
                </button>
              ))}
            </fieldset>
          )}
          <label className={s.label} htmlFor="town-status-text">
            {t.textLabel}
          </label>
          <input
            id="town-status-text"
            className={s.textInput}
            value={text}
            maxLength={LIMITS.statusTextMax}
            placeholder={t.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
          <p className={s.explain}>{t.textHelp}</p>
          <div className={s.actionRow}>
            <Button type="submit" size="sm" disabled={!connected}>
              {t.apply}
            </Button>
            {text && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!connected}
                onClick={() => {
                  setText('');
                  apply('');
                }}
              >
                {t.clear}
              </Button>
            )}
          </div>
          {!connected && <p className={s.err}>{t.notConnected}</p>}
        </form>

        <div className={s.todayBox}>
          <div className={s.todayTitle}>{t.todayTitle}</div>
          {!sharing ? (
            <p className={s.explain}>{t.todaySharingOff}</p>
          ) : !today || (today.schedule.length === 0 && !today.now) ? (
            <p className={s.explain}>{fresh.loading && !fresh.data ? ko.common.loading : t.todayEmpty}</p>
          ) : (
            <ul className={s.todayList}>
              {today.schedule.map((b) => (
                <li key={`${b.startAt}-${b.endAt}-${b.kind}`}>
                  <span className={s.todayTime}>{t.range(hm(b.startAt), hm(b.endAt))}</span>
                  <span>{t.scheduleKind[b.kind]}</span>
                </li>
              ))}
              {today.now && (
                <li>
                  <span className={s.todayTime}>{t.todayNow(t.nowKind[today.now.kind], hm(today.now.until))}</span>
                </li>
              )}
            </ul>
          )}
        </div>
        <div className={s.statusLinks}>
          <Link href="/me?tab=settings" onClick={() => ui.closePopover()}>
            {t.settingsLink}
          </Link>
          <button type="button" className={s.linkButton} onClick={() => ui.openMyPet()}>
            {t.myPet}
          </button>
          <Link href="/me?tab=logs" onClick={() => ui.closePopover()}>
            {t.myLog}
          </Link>
        </div>
      </div>
    </Popover>
  );
}
