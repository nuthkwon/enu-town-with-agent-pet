'use client';

import type { TodoDto } from '@enu/shared';
import { useState } from 'react';
import { Badge, Button, Card, Empty, Notice, cx } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { tomorrowMorning } from '@/lib/snooze';
import s from './me.module.css';

const t = ko.me.todos;

export function TodosTab({ initial, timezone }: { initial: TodoDto[]; timezone: string }) {
  const [todos, setTodos] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(
    id: string,
    body: { status?: 'open' | 'done' | 'dismissed'; snoozed_until?: string | null },
  ) {
    setBusy(id);
    setError(null);
    try {
      const updated = await apiFetch<TodoDto>(`/api/v1/me/todos/${id}`, { method: 'PATCH', body });
      setTodos((list) => list.map((x) => (x.id === id ? updated : x)));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={ko.me.tabs.todos}>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {todos.length === 0 ? (
        <Empty>{t.empty}</Empty>
      ) : (
        <ul className={s.list}>
          {todos.map((todo) => {
            const closed = todo.status === 'done' || todo.status === 'dismissed';
            const due = todo.dueAt
              ? formatDateTime(todo.dueAt, timezone)
              : todo.dueDate
                ? formatDate(todo.dueDate)
                : null;
            return (
              <li key={todo.id} className={cx(s.todo, s[`prio${todo.priority}`], closed && s.todoClosed)}>
                <div className={s.todoBody}>
                  <div className={s.todoTitle}>{todo.title}</div>
                  {todo.note && <div className={s.footNote}>{todo.note}</div>}
                  <div className={s.todoMeta}>
                    <Badge tone={closed ? 'gray' : todo.status === 'snoozed' ? 'amber' : 'lavender'}>
                      {ko.todoStatus[todo.status]}
                    </Badge>
                    {due && <span>{t.due(due)}</span>}
                    {todo.status === 'snoozed' && todo.snoozedUntil && (
                      <span>{t.snoozedUntil(formatDateTime(todo.snoozedUntil, timezone))}</span>
                    )}
                    <span>· {t.priority[todo.priority] ?? ''}</span>
                    {todo.statusSource === 'user' && <span>· {t.userChanged}</span>}
                  </div>
                </div>
                <div className={s.todoActions}>
                  {closed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === todo.id}
                      onClick={() => patch(todo.id, { status: 'open' })}
                    >
                      {t.reopen}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        disabled={busy === todo.id}
                        onClick={() => patch(todo.id, { status: 'done' })}
                      >
                        {t.done}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy === todo.id}
                        onClick={() =>
                          patch(todo.id, { snoozed_until: new Date(Date.now() + 3600_000).toISOString() })
                        }
                      >
                        {t.snooze1h}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy === todo.id}
                        onClick={() => patch(todo.id, { snoozed_until: tomorrowMorning(timezone) })}
                      >
                        {t.snoozeTomorrow}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === todo.id}
                        onClick={() => patch(todo.id, { status: 'dismissed' })}
                      >
                        {t.dismiss}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
