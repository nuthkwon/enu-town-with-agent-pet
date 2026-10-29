import { claudeLinks, type DbOrTx } from '@enu/db';
import type { ClaudeLinkDto } from '@enu/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { toClaudeLinkDto } from '../dto';

/** The viewer's Claude connector grants (active first, then revoked), newest consent first. */
export async function listClaudeLinks(
  db: DbOrTx,
  userId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ClaudeLinkDto[]> {
  const rows = await db
    .select()
    .from(claudeLinks)
    .where(and(eq(claudeLinks.userId, userId), opts.activeOnly ? isNull(claudeLinks.revokedAt) : undefined))
    .orderBy(desc(claudeLinks.consentedAt));
  return rows
    .map(toClaudeLinkDto)
    .sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null));
}
