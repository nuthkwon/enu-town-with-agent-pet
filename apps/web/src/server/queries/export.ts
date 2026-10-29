import {
  chatMessages,
  claudeLinks,
  desks,
  petNudges,
  privacyConsents,
  profiles,
  todos,
  user,
  workLogs,
  type DbOrTx,
} from '@enu/db';
import { PRIVACY_NOTICE_VERSION } from '@enu/shared';
import { asc, eq, isNull, and } from 'drizzle-orm';

/**
 * Everything ENU Town stores about the viewer that they authored or that is about them:
 * profile, logs, to-dos, pet bubbles, the chat messages they SENT, consents and Claude links.
 * Messages other people sent (including DMs to the viewer) are not included.
 */
export async function buildExport(db: DbOrTx, userId: string, now = new Date()) {
  const [account] = await db
    .select({ id: user.id, email: user.email, name: user.name, status: user.status, role: user.role, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, userId));
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  const [desk] = await db.select({ deskId: desks.deskId }).from(desks).where(eq(desks.userId, userId));
  const logs = await db
    .select()
    .from(workLogs)
    .where(and(eq(workLogs.userId, userId), isNull(workLogs.deletedAt)))
    .orderBy(asc(workLogs.periodKey));
  const myTodos = await db.select().from(todos).where(eq(todos.userId, userId)).orderBy(asc(todos.createdAt));
  const nudges = await db.select().from(petNudges).where(eq(petNudges.userId, userId)).orderBy(asc(petNudges.createdAt));
  const sent = await db
    .select({
      id: chatMessages.id,
      kind: chatMessages.kind,
      zoneId: chatMessages.zoneId,
      dmLow: chatMessages.dmLow,
      dmHigh: chatMessages.dmHigh,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.senderId, userId), isNull(chatMessages.deletedAt)))
    .orderBy(asc(chatMessages.createdAt));
  const consents = await db.select().from(privacyConsents).where(eq(privacyConsents.userId, userId));
  const links = await db.select().from(claudeLinks).where(eq(claudeLinks.userId, userId));

  return {
    format: 'enu-town-export',
    version: 1,
    exportedAt: now.toISOString(),
    noticeVersion: PRIVACY_NOTICE_VERSION,
    account: account ?? null,
    profile: profile ? { ...profile, deskId: desk?.deskId ?? null } : null,
    workLogs: logs.map((l) => ({
      id: l.id,
      periodKey: l.periodKey,
      periodStart: l.periodStart,
      periodEnd: l.periodEnd,
      summary: l.summary,
      tasks: l.tasks,
      blockers: l.blockers,
      claudeChatSummary: l.claudeChatSummary,
      visibility: l.visibility,
      visibilitySetBy: l.visibilitySetBy,
      chatSummaryVisibility: l.chatSummaryVisibility,
      source: l.source,
      claudeWrittenAt: l.claudeWrittenAt,
      claudeRevision: l.claudeRevision,
      editedByUser: l.editedByUser,
      userEditedAt: l.userEditedAt,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })),
    todos: myTodos,
    petNudges: nudges,
    sentChatMessages: sent.map((m) => ({
      id: m.id,
      kind: m.kind,
      zoneId: m.zoneId,
      toUserId: m.kind === 'dm' ? (m.dmLow === userId ? m.dmHigh : m.dmLow) : null,
      text: m.body,
      createdAt: m.createdAt,
    })),
    privacyConsents: consents,
    claudeLinks: links,
  };
}
