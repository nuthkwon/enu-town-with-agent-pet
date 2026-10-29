'use client';

import type { ChatMsg } from '@enu/protocol';
import type { ChatItemDto, Paginated } from '@enu/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ko } from '@/i18n/ko';
import { useConnectionStatus } from '@/realtime/useRealtime';
import { api, getJson } from './api';
import { mergeLine, type ChatLine as Line } from './chatLogic';
import { Composer } from './Composer';
import { formatHm } from './format';
import { useTown } from './TownContext';
import s from './town.module.css';

function fromChatMsg(m: ChatMsg): Line {
  return {
    key: m.id,
    id: m.id,
    clientMsgId: null,
    kind: 'room',
    fromUserId: m.fromUserId,
    fromName: m.fromName,
    text: m.text,
    createdAt: m.createdAt,
    state: 'sent',
  };
}

function fromHistory(m: ChatItemDto): Line {
  return {
    key: m.id,
    id: m.id,
    clientMsgId: null,
    kind: 'room',
    fromUserId: m.senderId,
    fromName: m.senderName,
    text: m.text,
    createdAt: m.createdAt,
    state: 'sent',
  };
}

/**
 * 전체 채팅 (history + live). Floating at the bottom-left on narrow windows; inside the docked team rail
 * at >= 1280 px so it never covers the map (the meeting table sits at the bottom-left).
 */
export function ChatDock({ docked = false }: { docked?: boolean }) {
  const { session, me } = useTown();
  const conn = useConnectionStatus(session);
  const [collapsed, setCollapsed] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  });

  // Small screens start with the dock folded so the map stays visible.
  useEffect(() => {
    if (!docked && window.matchMedia('(max-width: 640px)').matches) setCollapsed(true);
  }, [docked]);

  useEffect(() => {
    const offMsg = session.on('chat:msg', (m) => {
      setLines((prev) => mergeLine(prev, fromChatMsg(m), me.userId));
      if (collapsedRef.current && m.fromUserId !== me.userId) setUnseen((n) => n + 1);
    });
    const offAck = session.on('chat:ack', (a) => {
      setLines((prev) =>
        prev.map((l) =>
          l.clientMsgId === a.clientMsgId
            ? a.error
              ? { ...l, state: 'failed', error: ko.townUi.chat.errors[a.error] ?? ko.townUi.dm.failed }
              : { ...l, id: a.id ?? l.id, state: 'sent' }
            : l,
        ),
      );
    });
    return () => {
      offMsg();
      offAck();
    };
  }, [session, me.userId]);

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<Paginated<ChatItemDto>>(api.roomChat(), ctrl.signal)
      .then((page) => {
        const hist = (page?.items ?? [])
          .map(fromHistory)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        setLines((prev) => {
          let merged: Line[] = [];
          for (const h of hist) merged = mergeLine(merged, h, '');
          for (const l of prev) merged = mergeLine(merged, l, me.userId);
          return merged;
        });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [me.userId]);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, collapsed]);

  const send = (text: string): boolean => {
    const clientMsgId = session.sendChat(text);
    if (!clientMsgId) return false;
    const line: Line = {
      key: clientMsgId,
      id: null,
      clientMsgId,
      kind: 'room',
      fromUserId: me.userId,
      fromName: me.displayName,
      text,
      createdAt: new Date().toISOString(),
      state: 'pending',
    };
    stickRef.current = true;
    setLines((prev) => mergeLine(prev, line, '__none__'));
    return true;
  };

  const t = ko.townUi.chat;
  if (collapsed) {
    return (
      <div className={`${s.dock} ${s.dockCollapsed} ${docked ? s.dockDocked : ''}`}>
        <button
          type="button"
          className={s.pill}
          aria-expanded="false"
          onClick={() => {
            setCollapsed(false);
            setUnseen(0);
          }}
        >
          {t.title}
          {unseen > 0 && <span className={s.countBadge}>{unseen > 99 ? '99+' : unseen}</span>}
          <span className="visually-hidden">{t.expand}</span>
        </button>
      </div>
    );
  }

  return (
    <section className={`${s.dock} ${docked ? s.dockDocked : ''}`} aria-label={t.title}>
      <div className={s.dockHeader}>
        <span className={s.dockTitle}>{t.title}</span>
        <span className={s.spacer} />
        <button type="button" className={s.closeX} onClick={() => setCollapsed(true)} aria-label={t.collapse}>
          ▾
        </button>
      </div>
      <div
        ref={bodyRef}
        className={s.dockBody}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {lines.length === 0 ? (
          <div className={s.empty}>{t.empty}</div>
        ) : (
          <ul className={s.messages}>
            {lines.map((l) => (
              <li key={l.key} className={`${s.msg} ${l.state === 'pending' ? s.pending : ''}`}>
                <div className={s.msgMeta}>
                  <span className={s.msgName}>{l.fromName}</span>
                  <time dateTime={l.createdAt}>{formatHm(l.createdAt)}</time>
                </div>
                <div className={s.msgText}>{l.text}</div>
                {l.state === 'failed' && <div className={s.failed}>{l.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        placeholder={t.placeholder}
        label={t.placeholder}
        disabled={conn.kind !== 'connected'}
        disabledReason={t.notConnected}
      />
    </section>
  );
}
