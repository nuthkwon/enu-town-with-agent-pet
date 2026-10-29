'use client';

import type { AdminSeatsDto, LinkState } from '@enu/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Notice, selectClass, ui } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { AdminUserRow } from '@/server/queries/admin';
import { linkTone } from '../me/LinkTab';
import s from './admin.module.css';

const a = ko.admin;

export function AdminClient({
  seats: initialSeats,
  users,
  counts,
}: {
  seats: AdminSeatsDto;
  users: AdminUserRow[];
  counts: Record<LinkState, number> & { total: number };
}) {
  const router = useRouter();
  const [seats, setSeats] = useState(initialSeats);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const activeUsers = seats.users.filter((u) => u.status === 'active');

  async function assign(deskId: string, userId: string | null) {
    setBusy(deskId);
    setMessage(null);
    try {
      setSeats(
        await apiFetch<AdminSeatsDto>('/api/v1/admin/seats', {
          method: 'POST',
          body: { desk_id: deskId, user_id: userId },
        }),
      );
      setMessage({ tone: 'success', text: a.saved });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(u: AdminUserRow) {
    if (!window.confirm(a.deactivateConfirm(u.displayName))) return;
    setBusy(u.userId);
    setMessage(null);
    try {
      await apiFetch<{ ok: true }>(`/api/v1/admin/users/${u.userId}/deactivate`, {
        method: 'POST',
        body: {},
      });
      setSeats(await apiFetch<AdminSeatsDto>('/api/v1/admin/seats'));
      setMessage({ tone: 'success', text: a.saved });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  const pct = (n: number) => (counts.total ? Math.round((n / counts.total) * 100) : 0);

  return (
    <div className={s.page}>
      <h1 className={ui.sparkleTitle}>{a.title}</h1>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card title={a.adoptionTitle} subtitle={a.adoptionOf(counts.linked + counts.stale, counts.total)}>
        <div className={s.adoption}>
          {(['linked', 'stale', 'not_linked'] as const).map((k) => (
            <div key={k} className={s.stat}>
              <Badge tone={linkTone(k)} dot>
                {ko.linkState[k]}
              </Badge>
              <span className={s.statNum}>{counts[k]}</span>
              <span className={s.bar}>
                <span className={s[`fill_${k}`]} style={{ width: `${pct(counts[k])}%` }} />
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title={a.seatsTitle} subtitle={a.seatsHelp}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{a.desk}</th>
                <th>{a.occupant}</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {seats.desks.map((d) => (
                <tr key={d.deskId}>
                  <td>
                    <span className={s.deskCell}>{d.deskId}</span>
                    {!d.userId && d.displayName && (
                      <span className={s.labelHint}>
                        {a.label}: {d.displayName}
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className={selectClass}
                      aria-label={`${d.deskId} ${a.occupant}`}
                      value={d.userId ?? ''}
                      disabled={busy !== null}
                      onChange={(e) => assign(d.deskId, e.target.value || null)}
                    >
                      <option value="">{a.empty}</option>
                      {activeUsers.map((u) => (
                        <option key={u.userId} value={u.userId}>
                          {u.displayName}
                          {u.deskId && u.deskId !== d.deskId ? ` (${u.deskId})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {d.userId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => assign(d.deskId, null)}
                      >
                        {a.unassign}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={a.usersTitle} subtitle={a.usersHelp}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{a.name}</th>
                <th>{a.email}</th>
                <th>{a.status}</th>
                <th>{a.linkState}</th>
                <th>{a.lastLog}</th>
                <th>{a.seat}</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className={u.status !== 'active' ? s.inactive : undefined}>
                  <td>
                    <span className={s.nameCell}>
                      {u.displayName}
                      {u.role === 'admin' && <Badge tone="pink">{ko.common.adminBadge}</Badge>}
                    </span>
                  </td>
                  <td className={s.mono}>{u.email}</td>
                  <td>
                    <Badge tone={u.status === 'active' ? 'mint' : 'gray'}>
                      {u.status === 'active' ? a.active : a.deactivated}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={linkTone(u.linkState)} dot>
                      {ko.linkState[u.linkState]}
                    </Badge>
                  </td>
                  <td>{u.lastLogDate ? formatDate(u.lastLogDate) : '-'}</td>
                  <td>{u.deskId ?? '-'}</td>
                  <td>
                    {u.status === 'active' && !u.isSelf && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => deactivate(u)}
                      >
                        {a.deactivate}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
