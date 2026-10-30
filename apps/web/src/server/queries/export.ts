import {
  activityReports,
  chatMessages,
  claudeLinks,
  desks,
  petChannelTokens,
  petMessages,
  petNudges,
  pets,
  privacyConsents,
  profiles,
  todos,
  user,
  workLogEntries,
  workLogs,
  type DbOrTx,
} from '@enu/db';
import { PRIVACY_NOTICE_VERSION } from '@enu/shared';
import { asc, eq, isNull, and } from 'drizzle-orm';

/**
 * Everything ENU Den stores about the viewer that they authored or that is about them:
 * profile (incl. 활동 공유, 접속 표시 and the hand-set status), logs, today's activity report (refs only
 * as has_ref: the keyed hashes are never handed out), to-dos, pet bubbles, the chat messages they SENT,
 * consents, Claude links (and paired Claude Code machines, without token hashes), my pets (with their role instructions) and my pet conversations (my messages and my
 * Claude's replies). Messages other people sent (including DMs to the viewer) are not included.
 */
export async function buildExport(db: DbOrTx, userId: string, now = new Date()) {
  const [account] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      role: user.role,
      createdAt: user.createdAt,
    })
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
  const nudges = await db
    .select()
    .from(petNudges)
    .where(eq(petNudges.userId, userId))
    .orderBy(asc(petNudges.createdAt));
  const sent = await db
    .select({
      id: chatMessages.id,
      kind: chatMessages.kind,
      dmLow: chatMessages.dmLow,
      dmHigh: chatMessages.dmHigh,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.senderId, userId), isNull(chatMessages.deletedAt)))
    .orderBy(asc(chatMessages.createdAt));
  const reports = await db
    .select()
    .from(activityReports)
    .where(eq(activityReports.userId, userId))
    .orderBy(asc(activityReports.periodKey));
  const myPets = await db.select().from(pets).where(eq(pets.userId, userId)).orderBy(asc(pets.createdAt));
  const petLines = await db
    .select()
    .from(petMessages)
    .where(eq(petMessages.userId, userId))
    .orderBy(asc(petMessages.createdAt), asc(petMessages.id));
  const feed = await db
    .select({
      id: workLogEntries.id,
      logId: workLogEntries.logId,
      dayKey: workLogEntries.dayKey,
      writtenAt: workLogEntries.writtenAt,
      inOfficeHours: workLogEntries.inOfficeHours,
      kind: workLogEntries.kind,
      changes: workLogEntries.changes,
    })
    .from(workLogEntries)
    .where(eq(workLogEntries.userId, userId))
    .orderBy(asc(workLogEntries.dayKey), asc(workLogEntries.logId), asc(workLogEntries.seq));
  const consents = await db.select().from(privacyConsents).where(eq(privacyConsents.userId, userId));
  const links = await db.select().from(claudeLinks).where(eq(claudeLinks.userId, userId));
  const machines = await db
    .select({
      id: petChannelTokens.id,
      linkId: petChannelTokens.linkId,
      label: petChannelTokens.label,
      platform: petChannelTokens.platform,
      pluginVersion: petChannelTokens.pluginVersion,
      createdAt: petChannelTokens.createdAt,
      expiresAt: petChannelTokens.expiresAt,
    })
    .from(petChannelTokens)
    .where(eq(petChannelTokens.userId, userId))
    .orderBy(asc(petChannelTokens.createdAt));

  return {
    format: 'enu-den-export',
    version: 3,
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
    activityReports: reports.map((r) => ({
      periodKey: r.periodKey,
      now:
        r.nowKind && r.nowUntil
          ? { kind: r.nowKind, hasRef: r.nowRefHash !== null, until: r.nowUntil }
          : null,
      schedule: r.schedule.map((b) => ({
        startAt: b.start_at,
        endAt: b.end_at,
        kind: b.kind,
        hasRef: b.ref_hash !== null,
      })),
      source: r.source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    todos: myTodos,
    pets: myPets.map((p) => ({
      id: p.id,
      name: p.name,
      species: p.species,
      tint: p.tint,
      isDefault: p.isDefault,
      roleInstructions: p.roleInstructions,
      replyRoute: p.replyRoute,
      defaultVisibility: p.defaultVisibility,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    petMessages: petLines.map((m) => ({
      id: m.id,
      petId: m.petId,
      author: m.author,
      text: m.body,
      dayKey: m.dayKey,
      visibility: m.visibility,
      visibilitySetBy: m.visibilitySetBy,
      source: m.source,
      inReplyTo: m.inReplyTo,
      replyPart: m.replyPart,
      answerState: m.answerState,
      answeredLane: m.answeredLane,
      unread: m.unread,
      createdAt: m.createdAt,
    })),
    // The work feed's entries of my logs (ADR 0007): what each Claude write changed.
    workLogEntries: feed,
    petNudges: nudges,
    sentChatMessages: sent.map((m) => ({
      id: m.id,
      kind: m.kind,
      toUserId: m.kind === 'dm' ? (m.dmLow === userId ? m.dmHigh : m.dmLow) : null,
      text: m.body,
      createdAt: m.createdAt,
    })),
    privacyConsents: consents,
    claudeLinks: links,
    // Paired Claude Code machines; the token hashes are never handed out.
    petChannelMachines: machines,
  };
}
