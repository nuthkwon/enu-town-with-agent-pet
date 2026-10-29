'use client';

import type { DmMsg } from '@enu/protocol';
import type { ChatItemDto, DmThreadDto } from '@enu/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { useConnectionStatus, useDmUnread } from '@/realtime/useRealtime';
import { api } from './api';
import { Sheet } from './Chrome';
import { Composer } from './Composer';
import { formatAbsolute, formatRelative } from './format';
import { useDirectory, useFetch, useNow, usePaged } from './hooks';
import { useTown } from './TownContext';
import s from './town.module.css';

interface DmLine {
  key: string;
  id: string | null;
  fromUserId: string;
  text: string;
  createdAt: string;
  pending: boolean;
}

function fromItem(m: ChatItemDto): DmLine {
  return { key: m.id, id: m.id, fromUserId: m.senderId, text: m.text, createdAt: m.createdAt, pending: false };
}

function fromDm(m: DmMsg): DmLine {
  return { key: m.id, id: m.id, fromUserId: m.fromUserId, text: m.text, createdAt: m.createdAt, pending: false };
}

function Conversation({ peerId, draft }: { peerId: string; draft: string | null }) {
  const { session, me, directory } = useTown();
  const conn = useConnectionStatus(session);
  const now = useNow();
  const paged = usePaged<ChatItemDto>(`dm:${peerId}`, (before) => api.dmConversation(peerId, before));
  const [live, setLive] = useState<DmLine[]>([]);
  const [text, setText] = useState(draft ?? '');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const t = ko.townUi.dm;

  useEffect(() => {
    session.setActiveDmPeer(peerId);
    return () => session.setActiveDmPeer(null);
  }, [session, peerId]);

  useEffect(() => {
    return session.on('dm:msg', (m) => {
      const involved =
        (m.fromUserId === peerId && m.toUserId === me.userId) || (m.fromUserId === me.userId && m.toUserId === peerId);
      if (!involved) return;
      setLive((prev) => {
        if (prev.some((l) => l.id === m.id)) return prev;
        if (m.fromUserId === me.userId) {
          const i = prev.findIndex((l) => l.pending && l.text === m.text);
          if (i >= 0) {
            const next = [...prev];
            next[i] = { ...fromDm(m), key: prev[i]?.key ?? m.id };
            return next;
          }
        }
        return [...prev, fromDm(m)];
      });
    });
  }, [session, peerId, me.userId]);

  const history = [...paged.items].map(fromItem);
  const seen = new Set(history.map((h) => h.id));
  const lines = [...history, ...live.filter((l) => !l.id || !seen.has(l.id))].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  const lastFromPeer = [...lines].reverse().find((l) => l.fromUserId === peerId && l.id)?.id ?? null;

  // Opening the conversation (and every new message from the peer while it is open) marks it read.
  useEffect(() => {
    session.markDmRead(peerId, lastFromPeer);
  }, [session, peerId, lastFromPeer]);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    if (draft) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [draft]);

  const send = (value: string): boolean => {
    const id = session.sendDm(peerId, value);
    if (!id) return false;
    setLive((prev) => [
      ...prev,
      { key: id, id: null, fromUserId: me.userId, text: value, createdAt: new Date().toISOString(), pending: true },
    ]);
    return true;
  };

  const name = directory.person(peerId)?.displayName ?? '';
  return (
    <>
      <div ref={bodyRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {paged.nextCursor && !paged.loading && (
          <div className={s.loadMore}>
            <Button variant="ghost" size="sm" onClick={paged.loadMore}>
              {t.loadOlder}
            </Button>
          </div>
        )}
        {paged.loading && <div className={s.empty}>{ko.common.loading}</div>}
        {!paged.loading && lines.length === 0 && <div className={s.empty}>{t.conversationEmpty}</div>}
        <ul className={s.messages} role="log" aria-live="polite" aria-label={name}>
          {lines.map((l) => {
            const mine = l.fromUserId === me.userId;
            return (
              <li key={l.key} className={`${s.msg} ${mine ? s.msgRowMine : ''} ${l.pending ? s.pending : ''}`}>
                <div className={mine ? s.bubbleMine : s.bubbleTheirs}>{l.text}</div>
                <div className={s.msgMeta}>
                  <time dateTime={l.createdAt}>{formatAbsolute(l.createdAt, now)}</time>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div style={{ position: 'sticky', bottom: -18, marginTop: 12, marginLeft: -16, marginRight: -16 }}>
        <Composer
          ref={inputRef}
          value={text}
          onChange={setText}
          onSend={send}
          placeholder={t.placeholder}
          label={t.placeholder}
          rows={draft ? 3 : 2}
          disabled={conn.kind !== 'connected'}
          disabledReason={t.notConnected}
          note={draft ? t.draftNote : undefined}
        />
      </div>
    </>
  );
}

function Threads({ onPick }: { onPick: (peerId: string) => void }) {
  const { session, directory, me } = useTown();
  const snap = useDirectory(directory);
  const unread = useDmUnread(session);
  const now = useNow();
  const { data, loading, error, reload } = useFetch<DmThreadDto[]>(api.dmThreads());
  const [newPeer, setNewPeer] = useState('');
  const t = ko.townUi.dm;

  useEffect(() => session.on('dm:msg', () => reload()), [session, reload]);

  const threads = data ?? [];
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <select
          className={s.textInput}
          aria-label={t.pickPerson}
          value={newPeer}
          onChange={(e) => setNewPeer(e.target.value)}
        >
          <option value="">{t.pickPerson}</option>
          {snap.people
            .filter((p) => p.userId !== me.userId)
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.displayName}
              </option>
            ))}
        </select>
        <Button size="sm" disabled={!newPeer} onClick={() => newPeer && onPick(newPeer)}>
          {t.newChat}
        </Button>
      </div>
      {loading && !data && <div className={s.empty}>{ko.common.loading}</div>}
      {error && <div className={s.empty}>{ko.townUi.loadFailed}</div>}
      {!loading && !error && threads.length === 0 && <div className={s.empty}>{t.empty}</div>}
      <ul className={s.personList}>
        {threads.map((th) => {
          const n = unread.byPeer[th.peerId] ?? th.unread;
          return (
            <li key={th.peerId}>
              <button type="button" className={s.person} onClick={() => onPick(th.peerId)}>
                <span className={s.personMain}>
                  <span className={s.personName}>{th.peerName}</span>
                  <span className={s.personSub}>{th.lastText}</span>
                </span>
                <span className={s.presence}>{formatRelative(th.lastAt, now)}</span>
                {n > 0 && (
                  <span className={s.countBadge} aria-label={ko.townUi.topBar.unread(n)}>
                    {n}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** DM drawer: thread list, conversation with live messages, composer (drafts are never auto-sent). */
export function DmDrawer({ peerId, draft }: { peerId: string | null; draft: string | null }) {
  const { ui, directory } = useTown();
  useDirectory(directory);
  const [peer, setPeer] = useState<string | null>(peerId);
  const [initialDraft, setInitialDraft] = useState<string | null>(draft);
  const t = ko.townUi.dm;
  const peerName = peer ? (directory.person(peer)?.displayName ?? '') : '';
  return (
    <Sheet
      title={peer ? peerName : t.title}
      onClose={ui.closeSheet}
      headerExtra={
        peer ? (
          <button
            type="button"
            className={s.closeX}
            onClick={() => {
              setPeer(null);
              setInitialDraft(null);
            }}
            aria-label={t.back}
          >
            ←
          </button>
        ) : undefined
      }
    >
      {peer ? <Conversation key={peer} peerId={peer} draft={initialDraft} /> : <Threads onPick={setPeer} />}
    </Sheet>
  );
}
