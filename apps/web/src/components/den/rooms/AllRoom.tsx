'use client';

import type { ChatItemDto } from '@enu/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/components/town/api';
import { usePaged } from '@/components/town/hooks';
import { ko } from '@/i18n/ko';
import { useDen } from '../DenProvider';
import { ChatRoom, mergeRoomLines, usePendingLines, type RoomLine } from './ChatRoom';

function line(m: {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}): RoomLine {
  return {
    key: m.id,
    id: m.id,
    fromUserId: m.senderId,
    fromName: m.senderName,
    text: m.text,
    createdAt: m.createdAt,
    state: 'sent',
  };
}

/** 전체 방: history over REST, live lines and acks over the realtime session (the same room as the town chat). */
export function AllRoom() {
  const { me, session, status } = useDen();
  const paged = usePaged<ChatItemDto>('room', (before) => api.roomChat(before));
  const [live, setLive] = useState<RoomLine[]>([]);
  const { pending, add } = usePendingLines(session);

  useEffect(
    () =>
      session.on('chat:msg', (m) =>
        setLive((prev) =>
          prev.some((l) => l.id === m.id)
            ? prev
            : [...prev, line({ ...m, senderId: m.fromUserId, senderName: m.fromName })],
        ),
      ),
    [session],
  );

  const lines = useMemo(() => {
    const byId = new Map<string, RoomLine>();
    for (const m of paged.items) byId.set(m.id, line(m));
    for (const l of live) if (l.id) byId.set(l.id, l);
    return mergeRoomLines(byId.values(), pending);
  }, [paged.items, live, pending]);

  const send = (text: string): boolean => {
    const clientMsgId = session.sendChat(text);
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
      title={ko.den.room.allTitle}
      lead={ko.den.room.allLead}
      myUserId={me.userId}
      lines={lines}
      showNames
      loading={paged.loading}
      hasOlder={paged.nextCursor !== null}
      onOlder={paged.loadMore}
      onSend={send}
      disabled={status.kind !== 'connected'}
    />
  );
}
