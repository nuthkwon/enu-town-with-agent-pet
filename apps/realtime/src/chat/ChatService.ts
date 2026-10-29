import { chatMessages, dmReadState, newId, user, type Db } from '@enu/db';
import type { DmUnreadMsg } from '@enu/protocol';
import { LIMITS, prepareHumanText, type HumanTextError } from '@enu/shared';
import { and, count, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';

export type ChatTextError = HumanTextError;

/**
 * Meaning-preserving hygiene only (NFC, control/invisible characters). Room chat is a single line;
 * DMs keep their line breaks. Over-long text is rejected, never cut.
 */
export function prepareChatText(
  raw: string,
  opts: { multiline: boolean },
): { ok: true; text: string } | { ok: false; error: ChatTextError } {
  return prepareHumanText(raw, { multiline: opts.multiline, max: LIMITS.chatMaxLen });
}

export interface StoredMessage {
  id: string;
  createdAt: Date;
  /** True when (sender, clientMsgId) already existed: nothing new was stored or should be delivered. */
  duplicate: boolean;
}

export function dmPair(a: string, b: string): { dmLow: string; dmHigh: string } {
  return a < b ? { dmLow: a, dmHigh: b } : { dmLow: b, dmHigh: a };
}

/** Chat persistence. Realtime writes chat rows itself; web only reads them (history panels). */
export class ChatService {
  constructor(private readonly db: Db) {}

  /** Stores a room message (everyone in the office hears it; nearby chat no longer exists). */
  async storeRoomMessage(input: {
    senderId: string;
    body: string;
    clientMsgId: string;
  }): Promise<StoredMessage> {
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        id: newId(),
        kind: 'room',
        senderId: input.senderId,
        body: input.body,
        clientMsgId: input.clientMsgId,
      })
      .onConflictDoNothing({ target: [chatMessages.senderId, chatMessages.clientMsgId] })
      .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });
    if (!row)
      return { ...(await this.existing(this.db, input.senderId, input.clientMsgId)), duplicate: true };
    return { id: row.id, createdAt: row.createdAt, duplicate: false };
  }

  async storeDm(input: {
    senderId: string;
    toUserId: string;
    body: string;
    clientMsgId: string;
  }): Promise<StoredMessage> {
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        id: newId(),
        kind: 'dm',
        senderId: input.senderId,
        ...dmPair(input.senderId, input.toUserId),
        body: input.body,
        clientMsgId: input.clientMsgId,
      })
      .onConflictDoNothing({ target: [chatMessages.senderId, chatMessages.clientMsgId] })
      .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });
    if (!row)
      return { ...(await this.existing(this.db, input.senderId, input.clientMsgId)), duplicate: true };
    return { id: row.id, createdAt: row.createdAt, duplicate: false };
  }

  private async existing(
    db: Pick<Db, 'select'>,
    senderId: string,
    clientMsgId: string,
  ): Promise<{ id: string; createdAt: Date }> {
    const [row] = await db
      .select({ id: chatMessages.id, createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(and(eq(chatMessages.senderId, senderId), eq(chatMessages.clientMsgId, clientMsgId)))
      .limit(1);
    if (!row) throw new Error('chat message vanished after a unique conflict');
    return row;
  }

  /** Active user by id (DM targets may be offline but must exist and be active). */
  async findActiveUser(userId: string): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, userId), eq(user.status, 'active')))
      .limit(1);
    return row ?? null;
  }

  /**
   * Marks the DM thread with `peerId` read up to `lastMessageId` (its created_at), or up to now
   * when that id is not a message of this thread. Never moves the marker backwards.
   */
  async markDmRead(userId: string, peerId: string, lastMessageId: string, now: Date): Promise<boolean> {
    if (!(await this.userExists(peerId))) return false;
    const pair = dmPair(userId, peerId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lastMessageId);
    let readAt = now;
    if (isUuid) {
      const [m] = await this.db
        .select({ createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.id, lastMessageId),
            eq(chatMessages.kind, 'dm'),
            eq(chatMessages.dmLow, pair.dmLow),
            eq(chatMessages.dmHigh, pair.dmHigh),
          ),
        )
        .limit(1);
      if (m) readAt = m.createdAt;
    }
    await this.db
      .insert(dmReadState)
      .values({ userId, peerId, lastReadAt: readAt })
      .onConflictDoUpdate({
        target: [dmReadState.userId, dmReadState.peerId],
        set: { lastReadAt: sql`greatest(${dmReadState.lastReadAt}, excluded.last_read_at)` },
      });
    return true;
  }

  private async userExists(userId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    return !!row;
  }

  /** DMs to `userId` newer than their read marker, per sender. */
  async unreadCounts(userId: string): Promise<DmUnreadMsg> {
    const rows = await this.db
      .select({ peer: chatMessages.senderId, n: count() })
      .from(chatMessages)
      .leftJoin(
        dmReadState,
        and(eq(dmReadState.userId, userId), eq(dmReadState.peerId, chatMessages.senderId)),
      )
      .where(
        and(
          eq(chatMessages.kind, 'dm'),
          isNull(chatMessages.deletedAt),
          ne(chatMessages.senderId, userId),
          or(eq(chatMessages.dmLow, userId), eq(chatMessages.dmHigh, userId)),
          or(isNull(dmReadState.lastReadAt), gt(chatMessages.createdAt, dmReadState.lastReadAt)),
        ),
      )
      .groupBy(chatMessages.senderId);
    const byPeer: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byPeer[r.peer] = r.n;
      total += r.n;
    }
    return { total, byPeer };
  }
}
