'use client';

import {
  LIMITS,
  TASK_STATUSES,
  type Paginated,
  type TaskStatus,
  type Visibility,
  type WorkLogDto,
} from '@enu/shared';
import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Notice,
  Segmented,
  cx,
  inputClass,
  selectClass,
  textareaClass,
  type Tone,
} from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import s from './me.module.css';

const t = ko.me.logs;

const TASK_TONE: Record<string, Tone> = {
  done: 'mint',
  in_progress: 'lavender',
  planned: 'sky',
  blocked: 'danger',
};

const visibilityOptions = [
  { value: 'company' as const, label: ko.visibility.company },
  { value: 'private' as const, label: ko.visibility.private },
];

export function LogsTab({
  initial,
  focusId,
  timezone,
}: {
  initial: Paginated<WorkLogDto>;
  focusId: string | null;
  timezone: string;
}) {
  const [logs, setLogs] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await apiFetch<Paginated<WorkLogDto>>(
        `/api/v1/me/work-logs?cursor=${encodeURIComponent(cursor)}`,
      );
      setLogs((l) => [...l, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  if (logs.length === 0) {
    return (
      <Card title={ko.me.tabs.logs}>
        <Empty>{t.empty}</Empty>
      </Card>
    );
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {logs.map((log) => (
        <LogCard
          key={log.id}
          log={log}
          timezone={timezone}
          focused={log.id === focusId}
          onChange={(next) => setLogs((l) => l.map((x) => (x.id === next.id ? next : x)))}
          onDeleted={() => setLogs((l) => l.filter((x) => x.id !== log.id))}
        />
      ))}
      {cursor && (
        <div style={{ textAlign: 'center' }}>
          <Button variant="secondary" onClick={more} disabled={loading}>
            {loading ? ko.common.loading : ko.common.more}
          </Button>
        </div>
      )}
    </>
  );
}

function LogCard({
  log,
  timezone,
  focused,
  onChange,
  onDeleted,
}: {
  log: WorkLogDto;
  timezone: string;
  focused: boolean;
  onChange: (log: WorkLogDto) => void;
  onDeleted: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focused]);

  async function patch(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await apiFetch<WorkLogDto>(`/api/v1/me/work-logs/${log.id}`, { method: 'PATCH', body });
      onChange(updated);
      setMessage({ tone: 'success', text: okText });
      return true;
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t.deleteConfirm)) return;
    setBusy(true);
    try {
      await apiFetch<void>(`/api/v1/me/work-logs/${log.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(e) });
      setBusy(false);
    }
  }

  return (
    <div ref={ref} id={`log-${log.id}`} className={cx(s.logCard)}>
      <Card className={focused ? s.logFocus : undefined}>
        <div className={s.logHead}>
          <div>
            <div className={s.logDate}>{formatDate(log.periodKey)}</div>
            <div className={s.logBadges}>
              <Badge tone={log.visibility === 'company' ? 'mint' : 'gray'} dot>
                {ko.visibility[log.visibility]}
              </Badge>
              <Badge tone="lavender">{ko.provenance.byClaude(log.authorName)}</Badge>
              {log.editedByUser && <Badge tone="pink">{ko.provenance.editedBadge}</Badge>}
              <Badge tone="sky">{t.source[log.source] ?? log.source}</Badge>
            </div>
          </div>
          <div className={s.footNote} style={{ textAlign: 'right' }}>
            <div>{t.lastUpdate(formatDateTime(log.updatedAt, timezone))}</div>
            {log.userEditedAt && <div>{t.editedAt(formatDateTime(log.userEditedAt, timezone))}</div>}
          </div>
        </div>

        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {editing ? (
          <LogEditor
            log={log}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={async (body) => {
              if (await patch(body, ko.common.saved)) setEditing(false);
            }}
          />
        ) : (
          <LogView log={log} />
        )}

        <div className={s.controls}>
          <div className={s.control}>
            <span className={s.controlLabel}>{t.visibility}</span>
            <Segmented<Visibility>
              label={t.visibility}
              value={log.visibility}
              options={visibilityOptions}
              onChange={(v) => v !== log.visibility && !busy && patch({ visibility: v }, t.visibilitySaved)}
            />
          </div>
          <div className={s.control}>
            <span className={s.controlLabel}>{t.chatVisibility}</span>
            <Segmented<Visibility>
              label={t.chatVisibility}
              value={log.chatSummaryVisibility}
              options={visibilityOptions}
              onChange={(v) =>
                v !== log.chatSummaryVisibility &&
                !busy &&
                patch({ chat_summary_visibility: v }, t.visibilitySaved)
              }
            />
          </div>
          <div style={{ flex: 1 }} />
          {!editing && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              {ko.common.edit}
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
            {ko.common.delete}
          </Button>
        </div>
        {log.visibility === 'private' && log.chatSummaryVisibility === 'company' && (
          <p className={s.footNote} style={{ marginTop: 8 }}>
            {t.chatVisibilityNote}
          </p>
        )}
      </Card>
    </div>
  );
}

function LogView({ log }: { log: WorkLogDto }) {
  return (
    <>
      <div className={s.logSection}>
        <div className={s.logSectionTitle}>{t.summary}</div>
        <p className={s.logText}>{log.summary}</p>
      </div>
      {log.tasks.length > 0 && (
        <div className={s.logSection}>
          <div className={s.logSectionTitle}>{t.tasks}</div>
          <ul className={s.tasks}>
            {log.tasks.map((task, i) => (
              <li key={i} className={s.task}>
                <Badge tone={TASK_TONE[task.status] ?? 'gray'}>
                  {ko.taskStatus[task.status as TaskStatus] ?? task.status}
                </Badge>
                <span>{task.title}</span>
                {task.ref && <span className={s.taskRef}>{task.ref}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {log.blockers.length > 0 && (
        <div className={s.logSection}>
          <div className={s.logSectionTitle}>{t.blockers}</div>
          <ul className={s.blockers}>
            {log.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={s.logSection}>
        <div className={s.logSectionTitle}>
          {t.chatSummary}
          <Badge
            tone={log.chatSummaryVisibility === 'company' && log.visibility === 'company' ? 'mint' : 'gray'}
          >
            {ko.visibility[log.visibility === 'company' ? log.chatSummaryVisibility : 'private']}
          </Badge>
        </div>
        <div className={s.chatBox}>
          <p className={s.logText}>{log.claudeChatSummary ?? t.chatSummaryEmpty}</p>
        </div>
      </div>
    </>
  );
}

interface TaskDraft {
  title: string;
  status: TaskStatus;
  ref?: string;
}

function LogEditor({
  log,
  busy,
  onCancel,
  onSave,
}: {
  log: WorkLogDto;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [summary, setSummary] = useState(log.summary ?? '');
  const [tasks, setTasks] = useState<TaskDraft[]>(
    log.tasks.map((x) => ({
      title: x.title,
      status: (TASK_STATUSES as readonly string[]).includes(x.status)
        ? (x.status as TaskStatus)
        : 'in_progress',
      ...(x.ref ? { ref: x.ref } : {}),
    })),
  );
  const [blockers, setBlockers] = useState<string[]>(log.blockers);
  const [chat, setChat] = useState(log.claudeChatSummary ?? '');

  function save() {
    onSave({
      summary: summary.trim(),
      tasks: tasks.filter((x) => x.title.trim()).map((x) => ({ ...x, title: x.title.trim() })),
      blockers: blockers.map((b) => b.trim()).filter(Boolean),
      claude_chat_summary: chat.trim() ? chat.trim() : null,
    });
  }

  return (
    <div className={s.logSection}>
      <Field
        label={t.summary}
        htmlFor={`summary-${log.id}`}
        help={`${summary.length} / ${LIMITS.workLogSummaryMax}`}
      >
        <textarea
          id={`summary-${log.id}`}
          className={textareaClass}
          value={summary}
          maxLength={LIMITS.workLogSummaryMax}
          onChange={(e) => setSummary(e.target.value)}
        />
      </Field>

      <div className={s.logSectionTitle}>{t.tasks}</div>
      {tasks.map((task, i) => (
        <div key={i} className={s.editRow}>
          <input
            className={inputClass}
            aria-label={t.taskTitle}
            value={task.title}
            maxLength={LIMITS.workLogTaskTitleMax}
            onChange={(e) =>
              setTasks((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
            }
          />
          <select
            className={selectClass}
            aria-label={ko.me.logs.tasks}
            value={task.status}
            onChange={(e) =>
              setTasks((l) => l.map((x, j) => (j === i ? { ...x, status: e.target.value as TaskStatus } : x)))
            }
          >
            {TASK_STATUSES.map((st) => (
              <option key={st} value={st}>
                {ko.taskStatus[st]}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={() => setTasks((l) => l.filter((_, j) => j !== i))}>
            {ko.common.remove}
          </Button>
        </div>
      ))}
      {tasks.length < LIMITS.workLogTasksMax && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setTasks((l) => [...l, { title: '', status: 'in_progress' }])}
        >
          + {t.addTask}
        </Button>
      )}

      <div className={s.logSectionTitle} style={{ marginTop: 16 }}>
        {t.blockers}
      </div>
      {blockers.map((b, i) => (
        <div key={i} className={s.editRow} style={{ gridTemplateColumns: '1fr auto' }}>
          <input
            className={inputClass}
            aria-label={t.blockerText}
            value={b}
            maxLength={LIMITS.workLogBlockerMax}
            onChange={(e) => setBlockers((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button variant="ghost" size="sm" onClick={() => setBlockers((l) => l.filter((_, j) => j !== i))}>
            {ko.common.remove}
          </Button>
        </div>
      ))}
      {blockers.length < LIMITS.workLogBlockersMax && (
        <Button variant="secondary" size="sm" onClick={() => setBlockers((l) => [...l, ''])}>
          + {t.addBlocker}
        </Button>
      )}

      <div style={{ marginTop: 16 }}>
        <Field
          label={t.chatSummary}
          htmlFor={`chat-${log.id}`}
          help={`${chat.length} / ${LIMITS.claudeChatSummaryMax}`}
        >
          <textarea
            id={`chat-${log.id}`}
            className={textareaClass}
            value={chat}
            maxLength={LIMITS.claudeChatSummaryMax}
            onChange={(e) => setChat(e.target.value)}
          />
        </Field>
      </div>
      <p className={s.footNote}>{t.editHint}</p>
      <div className={s.saveBar}>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {ko.common.cancel}
        </Button>
        <Button onClick={save} disabled={busy || !summary.trim()}>
          {busy ? ko.common.saving : ko.common.save}
        </Button>
      </div>
    </div>
  );
}
