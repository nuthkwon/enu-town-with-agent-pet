import { getAuth } from '@/server/auth';

/** Better Auth (sign-in, sessions, dev login, OAuth 2.1 authorization server for the MCP connector). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (req: Request) => getAuth().handler(req);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
