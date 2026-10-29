'use client';

import { ko } from '@/i18n/ko';
import { Popover, onMenuKeyDown } from './Chrome';
import { useDirectory } from './hooks';
import { useTown } from './TownContext';
import { workRequestDraft, workRequestsFor } from './workRequests';
import s from './town.module.css';

/**
 * Role-aware work requests: templates for the colleague's team (e.g. 검토 요청 (SQA) for 품질보증팀)
 * plus generic ones. Picking one opens a DM draft; nothing is ever sent automatically.
 */
export function WorkRequestMenu({ userId, x, y }: { userId: string; x: number; y: number }) {
  const { directory, ui } = useTown();
  useDirectory(directory);
  const person = directory.person(userId);
  const kinds = workRequestsFor(person?.team ?? null);
  const t = ko.townUi.workRequest;
  return (
    <Popover x={x} y={y} onClose={ui.closePopover} label={t.title} role="menu">
      <div className={s.popoverHeader}>
        <div className={s.popoverTitle}>{t.title}</div>
      </div>
      <p className={s.menuHint}>{t.help}</p>
      <div className={s.menu} onKeyDown={onMenuKeyDown}>
        {kinds.map((k, i) => (
          <button
            key={k.id}
            type="button"
            role="menuitem"
            className={s.menuItem}
            data-autofocus={i === 0 ? true : undefined}
            onClick={() => {
              ui.closePopover();
              ui.openDm(userId, workRequestDraft(k.id));
            }}
          >
            <span className={s.menuIcon} aria-hidden="true">
              {k.teams ? '★' : '·'}
            </span>
            {k.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}
