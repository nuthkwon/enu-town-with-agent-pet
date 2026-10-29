import {
  oauthAccessToken,
  oauthClientAssertion,
  oauthRefreshToken,
  session,
  verification,
  type DbOrTx,
} from '@enu/db';
import { inArray, lt, or } from 'drizzle-orm';
import { affected, inBatches } from './types';

/**
 * Revoked/expired refresh tokens are kept this long so Better Auth can still recognise a
 * replayed (rotated or revoked) token and revoke its family instead of answering "unknown token".
 */
export const REFRESH_TOKEN_GRACE_DAYS = 7;
export const AUTH_CLEANUP_BATCH_SIZE = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuthCleanupSummary {
  sessions: number;
  verifications: number;
  accessTokens: number;
  refreshTokens: number;
  clientAssertions: number;
}

/**
 * auth.cleanup (daily 03:47 local). Better Auth tables use `timestamp without time zone`
 * holding UTC wall-clock values; comparisons go through drizzle column encoders, which
 * write the same UTC representation, so `now` compares correctly whatever the DB TimeZone.
 */
export async function cleanupAuth(db: DbOrTx, now: Date, opts: { batchSize?: number } = {}): Promise<AuthCleanupSummary> {
  const batch = opts.batchSize ?? AUTH_CLEANUP_BATCH_SIZE;
  const graceCutoff = new Date(now.getTime() - REFRESH_TOKEN_GRACE_DAYS * DAY_MS);

  // Refresh tokens first: their access tokens cascade (refresh_id ... on delete cascade).
  const refreshTokens = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(oauthRefreshToken)
        .where(
          inArray(
            oauthRefreshToken.id,
            db
              .select({ id: oauthRefreshToken.id })
              .from(oauthRefreshToken)
              .where(or(lt(oauthRefreshToken.expiresAt, graceCutoff), lt(oauthRefreshToken.revoked, graceCutoff)))
              .limit(limit),
          ),
        ),
    ),
  );

  const accessTokens = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(oauthAccessToken)
        .where(
          inArray(
            oauthAccessToken.id,
            db
              .select({ id: oauthAccessToken.id })
              .from(oauthAccessToken)
              .where(lt(oauthAccessToken.expiresAt, now))
              .limit(limit),
          ),
        ),
    ),
  );

  const sessions = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(session)
        .where(
          inArray(
            session.id,
            db.select({ id: session.id }).from(session).where(lt(session.expiresAt, now)).limit(limit),
          ),
        ),
    ),
  );

  const verifications = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(verification)
        .where(
          inArray(
            verification.id,
            db.select({ id: verification.id }).from(verification).where(lt(verification.expiresAt, now)).limit(limit),
          ),
        ),
    ),
  );

  const clientAssertions = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(oauthClientAssertion)
        .where(
          inArray(
            oauthClientAssertion.id,
            db
              .select({ id: oauthClientAssertion.id })
              .from(oauthClientAssertion)
              .where(lt(oauthClientAssertion.expiresAt, now))
              .limit(limit),
          ),
        ),
    ),
  );

  return { sessions, verifications, accessTokens, refreshTokens, clientAssertions };
}
