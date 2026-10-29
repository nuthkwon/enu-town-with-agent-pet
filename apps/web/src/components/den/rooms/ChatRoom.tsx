'use client';

import { APP_TIMEZONE_DEFAULT, LIMITS, graphemeLength, localDateKey } from '@enu/shared';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isSendEnter } from '@/components/town/chatLogic';
import { formatHm } from '@/components/town/format';
import { Button, cx } from '@/components/ui';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import { dayLabel } from '../model/dayLabel';
import s from '../den.module.css';

export interface RoomLine {
  key: string;
  id: string | null;
  fromUserId: string;
  fromName: string;
  text: string;
  createdAt: string;
  state: 'sent' | 'pending' | 'failed';
  error?: string;
}

/** Sorted by time; a line I just sent stays last until the server echoes it. */
export function sortLines(lines: readonly RoomLine[]): RoomLine[] {
  return [...lines].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Server-confirmed lines in time order, then my own lines the server has not echoed yet. */
export function mergeRoomLines(confirmed: Iterable<RoomLine>, pending: readonly RoomLine[]): RoomLine[] {
  const list = sortLines([...confirmed]);
  const ids = new Set(list.map((l) => l.id));
  return [...list, ...pending.filter((l) => !(l.id && ids.has(l.id)))];
}

/** My lines on their way (chat and DM sends are both acknowledged with `chat:ack`). */
export function usePendingLines(session: RealtimeSession): {
  pending: RoomLine[];
  add: (line: RoomLine) => void;
} {
  const [pending, setPending] = useState<RoomLine[]>([]);
  useEffect(
    () =>
      session.on('chat:ack', (a) =>
        setPending((prev) =>
          prev.map((l): RoomLine => {
            if (l.key !== a.clientMsgId) return l;
            if (!a.error) return { ...l, id: a.id, state: 'sent' };
            return { ...l, state: 'failed', error: ko.townUi.chat.errors[a.error] ?? ko.den.room.failed };
          }),
        ),
      ),
    [session],
  );
  const add = useCallback((line: RoomLine) => setPending((prev) => [...prev, line]), []);
  return { pending, add };
}

/**
 * The people rooms (전체 방 and 1:1 DMs): the same plain-text log as the town's chat, shown as a messenger page.
 * These are conversations between people, so they keep their times (pet rooms show dates only to colleagues).
 */
export function ChatRoom({
  title,
  lead,
  myUserId,
  lines,
  showNames,
  loading,
  hasOlder,
  onOlder,
  onSend,
  disabled,
  headExtra,
}: {
  title: string;
  lead?: string;
  myUserId: string;
  lines: RoomLine[];
  showNames: boolean;
  loading: boolean;
  hasOlder: boolean;
  onOlder: () => void;
  onSend: (text: string) => boolean;
  disabled: boolean;
  headExtra?: ReactNode;
}) {
  const t = ko.den.room;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const todayKey = localDateKey(new Date(), APP_TIMEZONE_DEFAULT);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const len = graphemeLength(draft);
  const over = len > LIMITS.chatMaxLen;
  const send = () => {
    if (disabled || over || !draft.trim()) return;
    stick.current = true;
    if (onSend(draft)) {
      setDraft('');
      setError(null);
    } else {
      setError(t.failed);
    }
  };

  const dayOf = (l: RoomLine) => localDateKey(new Date(l.createdAt), APP_TIMEZONE_DEFAULT);
  return (
    <>
      <header className={s.roomHead}>
        <div>
          <h1 className={s.roomTitle} tabIndex={-1}>
            {title}
          </h1>
          {lead && <p className={s.roomSub}>{lead}</p>}
        </div>
        {headExtra && <div className={s.headActions}>{headExtra}</div>}
      </header>
      <div
        className={s.timeline}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {hasOlder && (
          <div className={s.older}>
            <Button size="sm" variant="secondary" onClick={onOlder} disabled={loading}>
              {t.older}
            </Button>
          </div>
        )}
        {loading && lines.length === 0 && <div className={s.empty}>{ko.common.loading}</div>}
        {!loading && lines.length === 0 && <div className={s.empty}>{t.empty}</div>}
        <ul
          className={s.timelineList}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={title}
        >
          {lines.map((l, i) => {
            const prev = i > 0 ? lines[i - 1] : undefined;
            const day = dayOf(l);
            const newDay = !prev || day !== dayOf(prev);
            const firstOfRun = newDay || l.fromUserId !== prev?.fromUserId;
            const mine = l.fromUserId === myUserId;
            return (
              <Fragment key={l.key}>
                {newDay && (
                  <li className={s.dayRow} aria-hidden="true">
                    <span className={s.day}>{dayLabel(day, todayKey)}</span>
                  </li>
                )}
                <li
                  className={cx(s.msg, mine ? s.msgOwner : s.msgPet, firstOfRun && s.runGap)}
                  data-author={mine ? 'me' : 'other'}
                  style={l.state === 'pending' ? { opacity: 0.6 } : undefined}
                >
                  {showNames && firstOfRun && !mine && <span className={s.meta}>{l.fromName}</span>}
                  <div className={s.bubble}>{l.text}</div>
                  <span className={s.meta}>
                    <time dateTime={l.createdAt}>{formatHm(l.createdAt)}</time>
                    {l.state === 'failed' && <span role="alert">{l.error ?? t.failed}</span>}
                  </span>
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>
      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {error && (
          <div className={s.alert} role="alert">
            {error}
          </div>
        )}
        <div className={s.composerRow}>
          <textarea
            className={s.composerInput}
            value={draft}
            rows={1}
            aria-label={t.placeholder}
            placeholder={t.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSendEnter(e)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" disabled={disabled || over || !draft.trim()}>
            {t.send}
          </Button>
        </div>
        <div className={s.composerBar}>
          <span role={disabled ? 'status' : undefined}>{disabled ? t.offline : ''}</span>
          <span style={over ? { color: 'var(--c-danger)' } : undefined}>
            {len}/{LIMITS.chatMaxLen}
          </span>
        </div>
      </form>
    </>
  );
}
