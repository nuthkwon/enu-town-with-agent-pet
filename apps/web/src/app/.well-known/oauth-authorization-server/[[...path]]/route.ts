import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { getAuth } from '@/server/auth';

/** RFC 8414 metadata. The issuer is {PUBLIC_URL}/api/auth, so clients look under .../api/auth. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let serve: ((req: Request) => Promise<Response>) | undefined;

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const suffix = (path ?? []).join('/');
  if (suffix !== '' && suffix !== 'api/auth') return new Response('Not Found', { status: 404 });
  serve ??= oauthProviderAuthServerMetadata(getAuth());
  return serve(req);
}
