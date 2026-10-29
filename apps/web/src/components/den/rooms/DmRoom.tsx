'use client';

import type { ChatItemDto } from '@enu/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/components/town/api';
import { useDirectory, usePaged } from '@/components/town/hooks';
import { ko } from '@/i18n/ko';
import { useDen } from '../DenProvider';
import { ChatRoom, mergeRoomLines, usePendingLines, type RoomLine } from './ChatRoom';

/** A 1:1 DM page: history over REST, live messages over the session; opening it marks the thread read. */
export function DmRoom({ peerId }: { peerId: string }) {
  const { me, session, status, directory } = useDen();
  useDirectory(directory);
  const peerName = directory.person(peerId)?.displayName ?? '';
  const paged = usePaged<ChatItemDto>(`dm:${peerId}`, (before) => api.dmConversation(peerId, before));
  const [live, setLive] = useState<RoomLine[]>([]);
  const { pending, add } = usePendingLines(session);

  useEffect(() => {
    session.setActiveDmPeer(peerId);
    return () => session.setActiveDmPeer(null);
  }, [session, peerId]);

  useEffect(
    () =>
      session.on('dm:msg', (m) => {
        const involved =
          (m.fromUserId === peerId && m.toUserId === me.userId) ||
          (m.fromUserId === me.userId && m.toUserId === peerId);
        if (!involved) return;
        setLive((prev) =>
          prev.some((l) => l.id === m.id)
            ? prev
            : [
                ...prev,
                {
                  key: m.id,
                  id: m.id,
                  fromUserId: m.fromUserId,
                  fromName: m.fromName,
                  text: m.text,
                  createdAt: m.createdAt,
                  state: 'sent',
                },
              ],
        );
      }),
    [session, peerId, me.userId],
  );

  const lines = useMemo(() => {
    const byId = new Map<string, RoomLine>();
    for (const m of paged.items) {
      byId.set(m.id, {
        key: m.id,
        id: m.id,
        fromUserId: m.senderId,
        fromName: m.senderName,
        text: m.text,
        createdAt: m.createdAt,
        state: 'sent',
      });
    }
    for (const l of live) if (l.id) byId.set(l.id, l);
    return mergeRoomLines(byId.values(), pending);
  }, [paged.items, live, pending]);

  const lastFromPeer = [...lines].reverse().find((l) => l.fromUserId === peerId && l.id)?.id ?? null;
  useEffect(() => {
    session.markDmRead(peerId, lastFromPeer);
  }, [session, peerId, lastFromPeer]);

  const send = (text: string): boolean => {
    const clientMsgId = session.sendDm(peerId, text);
    if (!clientMsgId) return false;
    add({
      key: clientMsgId,
      id: null,
      fromUserId: me.userId,
      fromName: me.displayName,
      text,
      createdAt: new Date().toISOString(),
      state: 'pending',
    });
    return true;
  };

  return (
    <ChatRoom
      title={ko.den.room.dmTitle(peerName)}
      myUserId={me.userId}
      lines={lines}
      showNames={false}
      loading={paged.loading}
      hasOlder={paged.nextCursor !== null}
      onOlder={paged.loadMore}
      onSend={send}
      disabled={status.kind !== 'connected' || peerId === me.userId}
      headExtra={<Link href={`/people/${peerId}`}>{ko.den.room.profile}</Link>}
    />
  );
}
