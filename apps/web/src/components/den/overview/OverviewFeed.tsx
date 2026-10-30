'use client';

import type { WorkLogFeedItemDto } from '@enu/shared';
import type { CSSProperties } from 'react';
import { Button, cx } from '@/components/ui';
import { teamColor } from '@/game/directory';
import { ko } from '@/i18n/ko';
import { dayLabel } from '../model/dayLabel';
import { changeLabel } from '../model/overview';
import type { OverviewState } from './useOverview';
import o from './overview.module.css';

/**
 * The work feed (ADR 0007): what each Claude write changed, by office day, newest first. Today's timed entries carry
 * the `HH:MM` the server allowed; everything else is one line per person and day. Plain text only, and no live
 * region: a busy feed must not keep talking over the conversation.
 */
export function OverviewFeed({ state, variant }: { state: OverviewState; variant: 'compact' | 'full' }) {
  const t = ko.den.overview;
  const { days, error, loadingOlder } = state;
  const todayKey = days[0]?.isToday ? days[0].day : undefined;
  const last = days.at(-1);

  if (days.length === 0) {
    return (
      <div className={o.feedMessage} role="status">
        {error ? (
          <>
            <span>{t.error}</span>
            <Button size="sm" onClick={state.retry}>
              {ko.common.retry}
            </Button>
          </>
        ) : (
          <span>{t.loading}</span>
        )}
      </div>
    );
  }
  return (
    <div className={cx(o.feed, variant === 'full' && o.feedFull)}>
      {days.map((d) => (
        <section key={d.day} className={o.day} aria-label={dayLabel(d.day, todayKey)}>
          <h3 className={o.dayHead}>{dayLabel(d.day, todayKey)}</h3>
          {d.items.length === 0 ? (
            <p className={o.dayEmpty}>{t.empty}</p>
          ) : (
            <ul className={o.items}>
              {d.items.map((item) => (
                <FeedItem key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>
      ))}
      {error && (
        <p className={o.feedError}>
          {t.error}{' '}
          <Button size="sm" variant="ghost" onClick={state.retry}>
            {ko.common.retry}
          </Button>
        </p>
      )}
      {last?.prevDay && (
        <Button size="sm" variant="secondary" onClick={state.loadOlder} disabled={loadingOlder}>
          {loadingOlder ? t.loading : t.older}
        </Button>
      )}
    </div>
  );
}

function FeedItem({ item }: { item: WorkLogFeedItemDto }) {
  const t = ko.den.overview;
  return (
    <li className={o.item} style={{ '--team': teamColor(item.team) } as CSSProperties}>
      <div className={o.itemHead}>
        {item.time && <span className={o.time}>{item.time}</span>}
        <span className={o.who}>{t.byClaude(item.authorName)}</span>
        {item.form === 'digest' && <span className={o.digest}>{t.digest}</span>}
      </div>
      <ul className={o.changes}>
        {item.changes.map((c, i) => (
          <li key={i}>{changeLabel(c)}</li>
        ))}
      </ul>
    </li>
  );
}
