'use client';

import { ActivityCode, SourceCode } from '@enu/protocol';
import { activityIcon, activityLabel, sourceLabel } from '@/game/logic/presence';
import { ko } from '@/i18n/ko';
import { Popover } from './Chrome';
import { EffectIcon } from './EffectIcon';
import { useTown } from './TownContext';
import s from './town.module.css';

const ACTIVITIES = [
  ActivityCode.Available,
  ActivityCode.Focus,
  ActivityCode.Meeting,
  ActivityCode.Break,
  ActivityCode.Work,
  ActivityCode.Docs,
  ActivityCode.Review,
  ActivityCode.Collab,
  ActivityCode.Today,
] as const;

const SOURCES = [
  SourceCode.Manual,
  SourceCode.Calendar,
  SourceCode.Claude,
  SourceCode.WorkLog,
  SourceCode.Town,
] as const;

/** `?` — how to read the map (ko.townUi.legend): what moves avatars, what labels mean, and the controls. */
export function Legend({ x, y }: { x: number; y: number }) {
  const { ui } = useTown();
  const t = ko.townUi.legend;
  return (
    <Popover x={x} y={y} onClose={ui.closePopover} label={t.title} anchor="below">
      <div className={s.legend}>
        <div className={s.popoverHeader}>
          <div className={s.popoverTitle}>{t.title}</div>
          <button
            type="button"
            className={s.closeX}
            onClick={ui.closePopover}
            aria-label={t.close}
            data-autofocus
          >
            ✕
          </button>
        </div>
        <ul className={s.legendLines}>
          {t.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className={s.legendTitle}>{t.iconsTitle}</div>
        <ul className={s.legendIcons}>
          {ACTIVITIES.map((code) => {
            const icon = activityIcon(code);
            return (
              <li key={code}>
                {icon && <EffectIcon name={icon} />}
                <span>{activityLabel(code)}</span>
              </li>
            );
          })}
          <li>
            <span className={s.onlineDot} aria-hidden="true" />
            <span>{ko.townUi.people.online}</span>
          </li>
        </ul>
        <div className={s.legendTitle}>{t.sourcesTitle}</div>
        <p className={s.legendSources}>{SOURCES.map((c) => sourceLabel(c)).join(' · ')}</p>
        <div className={s.legendTitle}>{t.controlsTitle}</div>
        <ul className={s.legendLines}>
          {t.controls.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
