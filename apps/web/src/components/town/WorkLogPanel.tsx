'use client';

import type { WorkLogDto } from '@enu/shared';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { api } from './api';
import { Sheet } from './Chrome';
import { formatAbsolute, formatRelative } from './format';
import { useNow, usePaged } from './hooks';
import { useTown } from './TownContext';
import s from './town.module.css';

const TASK_STATUS_LABEL = ko.taskStatus as Record<string, string>;

/** One work log as written by its owner's Claude (plain text only) with provenance and times. */
export function WorkLogView({ log, now }: { log: WorkLogDto; now: Date }) {
  const t = ko.townUi.workLog;
  return (
    <article className={s.log}>
      <div className={s.logHead}>
        <span className={s.logDate}>{log.periodKey}</span>
        <span className={s.provenance}>{log.provenanceLabel}</span>
        {log.visibility === 'private' && <span className={s.provenance}>{t.privateBadge}</span>}
      </div>
      <div className={s.timeNote}>
        {t.updated} {formatRelative(log.updatedAt, now)} · {formatAbsolute(log.updatedAt, now)}
      </div>
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

/** '지금 하는 일': latest visible work log first, then older ones page by page. */
export function WorkLogPanel({ userId }: { userId: string }) {
  const { ui, directory, session } = useTown();
  const now = useNow();
  const name = session.getPlayer(userId)?.name || directory.person(userId)?.displayName || '';
  const t = ko.townUi.workLog;
  const paged = usePaged<WorkLogDto>(`worklogs:${userId}`, (cursor) => api.workLogs(userId, cursor));
  return (
    <Sheet title={t.title(name)} onClose={ui.closeSheet}>
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
