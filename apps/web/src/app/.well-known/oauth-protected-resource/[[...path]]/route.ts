import { getAuth } from '@/server/auth';

/**
 * RFC 9728 protected-resource metadata for /api/mcp. Served by the Better Auth mcp() plugin
 * (auth.handler matches /.well-known/oauth-protected-resource[/api/mcp]); never hand-written.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return getAuth().handler(req);
}
