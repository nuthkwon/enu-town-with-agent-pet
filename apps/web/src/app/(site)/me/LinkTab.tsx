'use client';

import type { ClaudeLinkDto, LinkState, MeDto } from '@enu/shared';
import { useState } from 'react';
import { LinkGuide } from '@/components/LinkGuide';
import { Badge, Button, Card, Empty, Notice, cx, type Tone } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import s from './me.module.css';

const t = ko.me.link;

export function linkTone(state: LinkState): Tone {
  return state === 'linked' ? 'mint' : state === 'stale' ? 'amber' : 'gray';
}

export function LinkTab({ me, initialLinks }: { me: MeDto; initialLinks: ClaudeLinkDto[] }) {
  const [links, setLinks] = useState(initialLinks);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const active = links.filter((l) => !l.revokedAt);

  async function revoke(linkId?: string) {
    if (!window.confirm(linkId ? t.revokeConfirm : t.revokeAllConfirm)) return;
    setBusy(linkId ?? 'all');
    setMessage(null);
    try {
      const r = await apiFetch<{ revoked: number }>('/api/v1/me/claude-links/revoke', {
        method: 'POST',
        body: linkId ? { link_id: linkId } : {},
      });
      setLinks(await apiFetch<ClaudeLinkDto[]>('/api/v1/me/claude-links'));
      setMessage({ tone: 'success', text: t.revokedToast(r.revoked) });
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card title={t.state}>
        <div className={s.stateRow}>
          <Badge tone={linkTone(me.linkState)} dot>
            {ko.linkState[me.linkState]}
          </Badge>
          <span className={s.footNote}>
            {t.lastLog}: {me.lastWorkLogAt ? formatDateTime(me.lastWorkLogAt, me.timezone) : ko.common.never}
          </span>
        </div>
        <p className={s.stateHelp}>{ko.linkStateHelp[me.linkState]}</p>
      </Card>

      <Card
        title={t.linksTitle}
        actions={
          active.length > 1 ? (
            <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => revoke()}>
              {t.revokeAll}
            </Button>
          ) : undefined
        }
      >
        {message && (
          <div style={{ marginBottom: 12 }}>
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        {links.length === 0 ? (
          <Empty>{t.linksEmpty}</Empty>
        ) : (
          <ul className={s.list}>
            {links.map((l) => (
              <li key={l.id} className={cx(s.linkItem, l.revokedAt && s.revoked)}>
                <span
                  className={cx(
                    s.linkIcon,
                    l.clientKind === 'claude_code' && s.linkIconCode,
                    l.clientKind === 'other' && s.linkIconOther,
                  )}
                  aria-hidden="true"
                >
                  {l.clientKind === 'claude_code' ? '>_' : '✦'}
                </span>
                <div className={s.linkBody}>
                  <div className={s.linkTitle}>
                    <span>{l.clientName ?? t.kind[l.clientKind]}</span>
                    <Badge tone={l.clientKind === 'claude_code' ? 'lavender' : 'sky'}>
                      {t.kind[l.clientKind]}
                    </Badge>
                    {l.revokedAt && <Badge tone="gray">{t.revoked}</Badge>}
                  </div>
                  <div className={s.linkMeta}>
                    <span>
                      {t.consentedAt} {formatDateTime(l.consentedAt, me.timezone)}
                    </span>
                    {l.redirectHost && (
                      <span>
                        {t.redirectHost} {l.redirectHost}
                      </span>
                    )}
                    <span>
                      {t.lastToolCall}{' '}
                      {l.lastToolCallAt ? formatDateTime(l.lastToolCallAt, me.timezone) : ko.common.never}
                    </span>
                    <span>{t.calls(l.toolCallCount)}</span>
                  </div>
                </div>
                {!l.revokedAt && (
                  <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => revoke(l.id)}>
                    {t.revoke}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={ko.linkGuide.title}>
        <LinkGuide mcpUrl={me.mcpUrl} />
      </Card>
    </>
  );
}
