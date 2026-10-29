import { chatMessageRecipients, chatMessages, dmReadState, profiles, user, type DbOrTx } from '@enu/db';
import type { ChatItemDto, DmThreadDto } from '@enu/shared';
import { and, desc, eq, exists, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { toChatItemDto } from '../dto';
import { paginate, type Cursor, type Page } from '../http';
import { beforeMicros, epochMicros } from './sql';

/**
 * Chat history readers. Pages are fetched newest-first with a `before` cursor (older pages),
 * and each page's items are returned in chronological order (oldest -> newest) so a chat view
 * can render them top to bottom and prepend older pages.
 */

export type HistoryKind = 'dm' | 'nearby' | 'room';

const sender = alias(profiles, 'sender_profile');
const senderUser = alias(user, 'sender_user');

function dmPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function fetchPage(
  db: DbOrTx,
  where: SQL | undefined,
  cursor: Cursor | null,
  limit: number,
): Promise<Page<ChatItemDto>> {
  const rows = await db
    .select({
      id: chatMessages.id,
      kind: chatMessages.kind,
      senderId: chatMessages.senderId,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      zoneId: chatMessages.zoneId,
      micros: epochMicros(chatMessages.createdAt),
      senderName: sender.displayName,
      senderFallback: senderUser.name,
    })
    .from(chatMessages)
    .leftJoin(sender, eq(sender.userId, chatMessages.senderId))
    .leftJoin(senderUser, eq(senderUser.id, chatMessages.senderId))
    .where(
      and(
        where,
        isNull(chatMessages.deletedAt),
        beforeMicros(chatMessages.createdAt, chatMessages.id, cursor),
      ),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit + 1);
  const page = paginate(rows, limit, (r) => ({ k: r.micros, id: r.id }));
  return {
    items: page.items.map((r) => toChatItemDto(r, r.senderName ?? r.senderFallback ?? '')).reverse(),
    nextCursor: page.nextCursor,
  };
}

/**
 * History between the viewer and `peerId`:
 *   dm     — DMs between the two (dm_low/dm_high pair)
 *   nearby — nearby messages sent by one of the two that the other one received (both directions)
 *   room   — public room messages sent by `peerId`
 */
export async function chatHistory(
  db: DbOrTx,
  viewerId: string,
  peerId: string,
  kind: HistoryKind,
  cursor: Cursor | null,
  limit: number,
): Promise<Page<ChatItemDto>> {
  if (kind === 'dm') {
    const [low, high] = dmPair(viewerId, peerId);
    return fetchPage(
      db,
      and(eq(chatMessages.kind, 'dm'), eq(chatMessages.dmLow, low), eq(chatMessages.dmHigh, high)),
      cursor,
      limit,
    );
  }
  if (kind === 'nearby') {
    const heardBy = (uid: string) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(chatMessageRecipients)
          .where(
            and(eq(chatMessageRecipients.messageId, chatMessages.id), eq(chatMessageRecipients.userId, uid)),
          ),
      );
    return fetchPage(
      db,
      and(
        eq(chatMessages.kind, 'nearby'),
        or(
          and(eq(chatMessages.senderId, viewerId), heardBy(peerId)),
          and(eq(chatMessages.senderId, peerId), heardBy(viewerId)),
        ),
      ),
      cursor,
      limit,
    );
  }
  return fetchPage(db, and(eq(chatMessages.kind, 'room'), eq(chatMessages.senderId, peerId)), cursor, limit);
}

/** The public room chat (everyone). */
export async function roomChat(db: DbOrTx, cursor: Cursor | null, limit: number): Promise<Page<ChatItemDto>> {
  return fetchPage(db, and(eq(chatMessages.kind, 'room')), cursor, limit);
}

/** The viewer's DM threads, most recent first, with unread counts (messages from the peer after last read). */
export async function dmThreads(db: DbOrTx, viewerId: string): Promise<DmThreadDto[]> {
  const rows = await db
    .select({
      id: chatMessages.id,
      senderId: chatMessages.senderId,
      dmLow: chatMessages.dmLow,
      dmHigh: chatMessages.dmHigh,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.kind, 'dm'),
        isNull(chatMessages.deletedAt),
        or(eq(chatMessages.dmLow, viewerId), eq(chatMessages.dmHigh, viewerId)),
      ),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(2000);

  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const peer = r.dmLow === viewerId ? r.dmHigh : r.dmLow;
    if (peer && !latest.has(peer)) latest.set(peer, r);
  }
  const peers = [...latest.keys()];
  if (peers.length === 0) return [];

  const [names, reads] = await Promise.all([
    db
      .select({ userId: user.id, displayName: profiles.displayName, name: user.name })
      .from(user)
      .leftJoin(profiles, eq(profiles.userId, user.id))
      .where(inArray(user.id, peers)),
    db
      .select({ peerId: dmReadState.peerId, lastReadAt: dmReadState.lastReadAt })
      .from(dmReadState)
      .where(and(eq(dmReadState.userId, viewerId), inArray(dmReadState.peerId, peers))),
  ]);
  const nameOf = new Map(names.map((n) => [n.userId, n.displayName ?? n.name]));
  const readAt = new Map(reads.map((r) => [r.peerId, r.lastReadAt]));

  const unread = new Map<string, number>();
  for (const r of rows) {
    if (r.senderId === viewerId) continue;
    const since = readAt.get(r.senderId);
    if (!since || r.createdAt > since) unread.set(r.senderId, (unread.get(r.senderId) ?? 0) + 1);
  }

  return peers.map((peerId) => {
    const m = latest.get(peerId)!;
    return {
      peerId,
      peerName: nameOf.get(peerId) ?? '',
      lastText: m.body,
      lastAt: m.createdAt.toISOString(),
      unread: unread.get(peerId) ?? 0,
    };
  });
}
