import { hkdfSync } from 'node:crypto';
import { requireMcpAuth } from '@better-auth/mcp';
import { invalidTokenChallenge, protectedResourceMetadataUrl, resolveMcpCaller } from '@enu/auth';
import { buildEnuTownMcpServer, callerFromAuthInfo } from '@enu/mcp-tools';
import { LIMITS } from '@enu/shared';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { authPolicy, getAuth, mcpResource } from '@/server/auth';
import { getDb } from '@/server/db';
import { getEnv, internalBaseUrl, publicUrl } from '@/server/env';

/**
 * The ENU Town MCP connector (Streamable HTTP, stateless). Token checks happen in order:
 * requireMcpAuth (signature/issuer/audience=this resource/expiry via our JWKS), then
 * resolveMcpCaller (active user, workspace domain, not revoked). Tools only ever see the
 * verified caller through AuthInfo.extra.userId; the raw token is never passed on.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let mcp: McpHttpHandler | undefined;
let protectedPost: ((req: Request) => Promise<Response>) | undefined;

/**
 * Key of post_activity's daily ref hash, derived once from BETTER_AUTH_SECRET (no extra secret to manage).
 * It keeps refs unlinkable across days, but anyone holding BETTER_AUTH_SECRET could test guesses.
 */
function activityRefKey(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret, 'enu-town', 'activity-ref/v1', 32));
}

function mcpHandler(): McpHttpHandler {
  if (mcp) return mcp;
  const env = getEnv();
  const refKey = activityRefKey(env.BETTER_AUTH_SECRET);
  mcp = createMcpHandler(
    ({ authInfo }) =>
      buildEnuTownMcpServer(
        { db: getDb(), publicUrl: publicUrl(), activityRefKey: refKey, officeTimeZone: env.APP_TIMEZONE },
        callerFromAuthInfo(authInfo),
      ),
    { legacy: 'stateless', responseMode: 'json', maxRequestBodySize: LIMITS.mcpBodyMaxBytes },
  );
  return mcp;
}

function postHandler(): (req: Request) => Promise<Response> {
  if (protectedPost) return protectedPost;
  const resource = mcpResource();
  protectedPost = requireMcpAuth(
    getAuth(),
    async (req, claims) => {
      const caller = await resolveMcpCaller(getDb(), claims, authPolicy());
      if (!caller.ok) return invalidTokenChallenge(protectedResourceMetadataUrl(resource), caller.reason);
      return mcpHandler().fetch(req, {
        authInfo: {
          token: '[redacted]',
          clientId: caller.clientId,
          scopes: caller.scopes,
          expiresAt: caller.expiresAt,
          extra: { userId: caller.userId, email: caller.email },
        },
      });
    },
    // The JWKS is fetched over HTTP; use the in-container address, not the public URL.
    { resource, jwksUrl: `${internalBaseUrl()}/api/auth/jwks` },
  );
  return protectedPost;
}

export async function POST(req: Request): Promise<Response> {
  return postHandler()(req);
}

/** Stateless mode: no SSE stream or session to delete (405 from the SDK). */
export async function GET(req: Request): Promise<Response> {
  return mcpHandler().fetch(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return mcpHandler().fetch(req);
}
