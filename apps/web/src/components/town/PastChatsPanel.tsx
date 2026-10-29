'use client';

import type { ChatItemDto, ClaudeSummaryDto } from '@enu/shared';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { api } from './api';
import { Sheet } from './Chrome';
import { formatAbsolute } from './format';
import { useNow, usePaged } from './hooks';
import { useTown, type PastChatsTab } from './TownContext';
import s from './town.module.css';

const TABS: PastChatsTab[] = ['dm', 'room', 'summaries'];

function byTimeAsc(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

function ChatHistory({ userId, kind }: { userId: string; kind: 'dm' | 'room' }) {
  const { me } = useTown();
  const now = useNow();
  const t = ko.townUi.pastChats;
  const paged = usePaged<ChatItemDto>(`history:${userId}:${kind}`, (before) => api.chatHistory(userId, kind, before));
  const items = [...paged.items].sort(byTimeAsc);
  return (
    <>
      {paged.nextCursor && !paged.loading && (
        <div className={s.loadMore}>
          <Button variant="ghost" size="sm" onClick={paged.loadMore}>
            {t.loadMore}
          </Button>
        </div>
      )}
      <ul className={s.messages}>
        {items.map((m) => {
          const mine = m.senderId === me.userId;
          return (
            <li key={m.id} className={`${s.msg} ${mine ? s.msgRowMine : ''}`}>
              <div className={s.msgMeta}>
                <span className={s.msgName}>{mine ? t.me : m.senderName}</span>
                <time dateTime={m.createdAt}>{formatAbsolute(m.createdAt, now)}</time>
              </div>
              <div className={mine ? s.bubbleMine : s.bubbleTheirs}>{m.text}</div>
            </li>
          );
        })}
      </ul>
      {paged.loading && <div className={s.empty}>{ko.common.loading}</div>}
      {paged.error && <div className={s.empty}>{ko.townUi.loadFailed}</div>}
      {!paged.loading && !paged.error && items.length === 0 && <div className={s.empty}>{t.empty[kind]}</div>}
    </>
  );
}

function ClaudeSummaries({ userId }: { userId: string }) {
  const now = useNow();
  const t = ko.townUi.pastChats;
  const paged = usePaged<ClaudeSummaryDto>(`summaries:${userId}`, (cursor) => api.claudeSummaries(userId, cursor));
  return (
    <>
      <p className={s.explain}>{t.summariesNote}</p>
      {paged.items.map((sum) => (
        <article key={sum.logId} className={s.log}>
          <div className={s.logHead}>
            <span className={s.logDate}>{sum.periodKey}</span>
            {/* Exact times are owner-only: colleagues get null and see only the day. */}
            {sum.updatedAt && <span className={s.timeNote}>{formatAbsolute(sum.updatedAt, now)}</span>}
          </div>
          <p className={s.prewrap}>{sum.summary}</p>
        </article>
      ))}
      {paged.loading && <div className={s.empty}>{ko.common.loading}</div>}
      {paged.error && <div className={s.empty}>{ko.townUi.loadFailed}</div>}
      {!paged.loading && !paged.error && paged.items.length === 0 && <div className={s.empty}>{t.empty.summaries}</div>}
      {paged.nextCursor && !paged.loading && (
        <div className={s.loadMore}>
          <Button variant="ghost" size="sm" onClick={paged.loadMore}>
            {t.loadMore}
          </Button>
        </div>
      )}
    </>
  );
}

/** 지난 대화: 우리 DM / 공개 채팅 / Claude 작업 대화 요약. */
export function PastChatsPanel({ userId, initialTab }: { userId: string; initialTab: PastChatsTab }) {
  const { ui, session, directory } = useTown();
  const [tab, setTab] = useState<PastChatsTab>(initialTab);
  const name = session.getPlayer(userId)?.name || directory.person(userId)?.displayName || '';
  const t = ko.townUi.pastChats;
  return (
    <Sheet title={t.title(name)} onClose={ui.closeSheet}>
      <div className={s.tabs} role="tablist" aria-label={t.title(name)}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`pc-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`pc-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            className={s.tab}
            onClick={() => setTab(k)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = TABS.indexOf(k);
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length] ?? 'dm';
              setTab(next);
              document.getElementById(`pc-tab-${next}`)?.focus();
            }}
          >
            {t.tabs[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`pc-panel-${tab}`} aria-labelledby={`pc-tab-${tab}`}>
        {tab === 'summaries' ? (
          <ClaudeSummaries userId={userId} />
        ) : (
          <ChatHistory key={tab} userId={userId} kind={tab} />
        )}
      </div>
    </Sheet>
  );
}
