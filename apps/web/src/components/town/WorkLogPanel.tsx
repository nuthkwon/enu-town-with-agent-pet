'use client';

import { PlateNote } from '@enu/protocol';
import type { WorkLogDto } from '@enu/shared';
import { Button } from '@/components/ui';
import { activityIcon, displayForm, groupsOf } from '@/game/logic/presence';
import { ko } from '@/i18n/ko';
import { useOfficeOpen, useRoster } from '@/realtime/useRealtime';
import { api } from './api';
import { Sheet } from './Chrome';
import { EffectIcon } from './EffectIcon';
import { formatAbsolute, formatRelative } from './format';
import { useNow, usePaged } from './hooks';
import { useTown } from './TownContext';
import s from './town.module.css';

const TASK_STATUS_LABEL = ko.taskStatus as Record<string, string>;

/**
 * One work log as written by its owner's Claude (plain text only) with provenance. Exact times are
 * owner-only (colleagues get null), so the update line appears only when the viewer may see it.
 */
export function WorkLogView({ log, now }: { log: WorkLogDto; now: Date }) {
  const t = ko.townUi.workLog;
  return (
    <article className={s.log}>
      <div className={s.logHead}>
        <span className={s.logDate}>{log.periodKey}</span>
        <span className={s.provenance}>{log.provenanceLabel}</span>
        {log.visibility === 'private' && <span className={s.provenance}>{t.privateBadge}</span>}
      </div>
      {log.updatedAt && (
        <div className={s.timeNote}>
          {t.updated} {formatRelative(log.updatedAt, now)} · {formatAbsolute(log.updatedAt, now)}
        </div>
      )}
      {log.summary && (
        <div className={s.logSection}>
          <div className={s.logLabel}>{t.summary}</div>
          <p className={s.prewrap}>{log.summary}</p>
        </div>
      )}
      {log.tasks.length > 0 && (
        <div className={s.logSection}>
          <div className={s.logLabel}>{t.tasks}</div>
          <ul className={s.taskList}>
            {log.tasks.map((task, i) => (
              <li key={i} className={s.task}>
                <span className={`${s.chip} ${s[`chip-${task.status}`] ?? ''}`}>
                  {TASK_STATUS_LABEL[task.status] ?? task.status}
                </span>
                <span>
                  {task.title}
                  {task.ref && <span className={s.taskRef}> · {task.ref}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {log.blockers.length > 0 && (
        <div className={s.logSection}>
          <div className={s.logLabel}>{t.blockers}</div>
          <ul className={s.blockers}>
            {log.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {log.claudeChatSummary && (
        <div className={s.logSection}>
          <div className={s.logLabel}>{t.chatSummary}</div>
          <p className={s.prewrap}>{log.claudeChatSummary}</p>
        </div>
      )}
    </article>
  );
}

/** The "지금" card: what the town shows about this person right now (the projected Player fields). */
export function NowCard({ userId }: { userId: string }) {
  const { session, directory, me } = useTown();
  const roster = useRoster(session);
  const officeOpen = useOfficeOpen(session);
  const player = roster.find((p) => p.id === userId);
  const t = ko.townUi.workLog;
  const tz = me.officeTimeZone;
  const form = player ? displayForm(player, tz) : '';
  const icon = player && player.note === PlateNote.None ? activityIcon(player.activity) : null;
  const group = player?.groupId ? groupsOf(roster).find((g) => g.id === player.groupId) : undefined;
  const nameOf = (id: string) => roster.find((p) => p.id === id)?.name || directory.person(id)?.displayName || '';
  return (
    <section className={s.nowCard} aria-label={t.nowTitle}>
      <div className={s.nowHead}>
        <span className={s.nowTitle}>{t.nowTitle}</span>
        {player?.online && (
          <span className={s.presence}>
            <span className={s.onlineDot} aria-hidden="true" />
            {ko.townUi.people.online}
          </span>
        )}
      </div>
      {officeOpen === false ? (
        <p className={s.nowLine}>{ko.townUi.profile.officeClosed}</p>
      ) : (
        <>
          <p className={s.nowLine}>
            {icon && <EffectIcon name={icon} />}
            <span>{form || ko.townUi.profile.nothingKnown}</span>
          </p>
          {player?.statusText && <p className={s.nowStatusText}>{player.statusText}</p>}
          {group && (
            <p className={s.nowGroup}>
              {t.nowGroup(group.family === 'meeting' ? ko.townUi.group.meetingTitle : ko.townUi.group.workTitle, group.members.length)}
              {' · '}
              {group.members.map((m) => nameOf(m.id)).join(', ')}
            </p>
          )}
        </>
      )}
      <p className={s.explain}>{t.nowHelp}</p>
    </section>
  );
}

/** '지금 하는 일': the "지금" card from the live state, then the visible work logs page by page. */
export function WorkLogPanel({ userId }: { userId: string }) {
  const { ui, directory, session } = useTown();
  const now = useNow();
  const name = session.getPlayer(userId)?.name || directory.person(userId)?.displayName || '';
  const t = ko.townUi.workLog;
  const paged = usePaged<WorkLogDto>(`worklogs:${userId}`, (cursor) => api.workLogs(userId, cursor));
  return (
    <Sheet title={t.title(name)} onClose={ui.closeSheet}>
      <NowCard userId={userId} />
      {paged.items.map((log) => (
        <WorkLogView key={log.id} log={log} now={now} />
      ))}
      {!paged.loading && !paged.error && paged.items.length === 0 && <div className={s.empty}>{t.empty}</div>}
      {paged.error && (
        <div className={s.empty}>
          {ko.townUi.loadFailed}{' '}
          <Button variant="ghost" size="sm" onClick={paged.reload}>
            {ko.common.retry}
          </Button>
        </div>
      )}
      {paged.loading && <div className={s.empty}>{ko.common.loading}</div>}
      {paged.nextCursor && !paged.loading && (
        <div className={s.loadMore}>
          <Button variant="secondary" size="sm" onClick={paged.loadMore}>
            {t.loadMore}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
