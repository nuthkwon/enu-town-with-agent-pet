'use client';

import type { ColleaguePetMessageDto, OwnerPetMessageDto, TaskStatus, WorkLogDto } from '@enu/shared';
import type { ReactNode } from 'react';
import { ko } from '@/i18n/ko';
import { dayLabel } from '../model/dayLabel';
import type { TimelineEntry } from '../model/timeline';
import s from '../den.module.css';

type AnyMessage = OwnerPetMessageDto | ColleaguePetMessageDto;

function LogCard({ log }: { log: WorkLogDto }) {
  return (
    <li className={s.logCard}>
      <h3>
        {ko.den.pet.workLogCard} · {log.provenanceLabel}
      </h3>
      {log.summary && <p>{log.summary}</p>}
      {log.tasks.length > 0 && (
        <ul className={s.logTasks}>
          {log.tasks.map((task, i) => (
            <li key={i}>
              {task.title} · {ko.taskStatus[task.status as TaskStatus] ?? task.status}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One pet room as a list (not a live region: new replies are announced only to the owner by the room's own
 * status region). Day separators show dates only; messages are plain text, exactly as written.
 */
export function Timeline<M extends AnyMessage>({
  entries,
  todayKey,
  petName,
  renderMeta,
  label,
}: {
  entries: TimelineEntry<M>[];
  todayKey?: string;
  petName: string;
  /** Owner-only details under a message (visibility, provenance, menu); colleagues get none. */
  renderMeta?: (m: M) => ReactNode;
  label: string;
}) {
  return (
    <ul className={s.timelineList} aria-label={label}>
      {entries.map((e) => {
        if (e.kind === 'day') {
          return (
            <li key={e.key} className={s.dayRow}>
              <span className={s.day}>{dayLabel(e.dayKey, todayKey)}</span>
            </li>
          );
        }
        if (e.kind === 'log') return <LogCard key={e.key} log={e.log} />;
        const m = e.message;
        const mine = m.author === 'owner';
        return (
          <li
            key={e.key}
            className={`${s.msg} ${mine ? s.msgOwner : s.msgPet} ${e.firstOfRun ? s.runGap : ''}`}
            data-message-id={m.id}
            data-author={m.author}
          >
            {e.firstOfRun && !mine && <span className={s.meta}>{petName}</span>}
            <div className={s.bubble}>{m.text}</div>
            {renderMeta?.(m)}
          </li>
        );
      })}
    </ul>
  );
}
