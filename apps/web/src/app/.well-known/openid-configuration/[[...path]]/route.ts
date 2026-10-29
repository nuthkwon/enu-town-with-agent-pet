import { oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';
import { getAuth } from '@/server/auth';

/** OpenID discovery at the root (path-insertion form for the /api/auth issuer). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let serve: ((req: Request) => Promise<Response>) | undefined;

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const suffix = (path ?? []).join('/');
  if (suffix !== '' && suffix !== 'api/auth') return new Response('Not Found', { status: 404 });
  serve ??= oauthProviderOpenIdConfigMetadata(getAuth());
  return serve(req);
}
