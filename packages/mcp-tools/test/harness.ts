import type { Db } from '@enu/db';
import { LIMITS } from '@enu/shared';
import { Client, StreamableHTTPClientTransport, type FetchLike } from '@modelcontextprotocol/client';
import { createMcpHandler, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';
import { buildEnuTownMcpServer, callerFromAuthInfo, type McpDeps } from '../src/index';

export const MODES = ['legacy', 'auto'] as const;
export type Mode = (typeof MODES)[number];

/** Who the (already verified) bearer token belongs to; null = the route passes no authInfo. */
export interface TestIdentity {
  userId?: string;
  clientId: string;
}

/** A fixed activity ref key (the web route derives the real one from BETTER_AUTH_SECRET). */
export const TEST_ACTIVITY_REF_KEY = new Uint8Array(32).fill(7);
export const OFFICE_TZ = 'Asia/Seoul';

/** McpDeps for tests: a fixed ref key and the Asia/Seoul office day. */
export function testDeps(db: Db, over: Partial<McpDeps> = {}): McpDeps {
  return {
    db,
    publicUrl: 'https://town.example',
    activityRefKey: TEST_ACTIVITY_REF_KEY,
    officeTimeZone: OFFICE_TZ,
    ...over,
  };
}

/** Same wiring as apps/web /api/mcp. */
export function createTestHandler(deps: McpDeps): McpHttpHandler {
  return createMcpHandler(({ authInfo }) => buildEnuTownMcpServer(deps, callerFromAuthInfo(authInfo)), {
    legacy: 'stateless',
    responseMode: 'json',
    maxRequestBodySize: LIMITS.mcpBodyMaxBytes,
  });
}

export async function connectClient(handler: McpHttpHandler, identity: TestIdentity | null, mode: Mode): Promise<Client> {
  const route = (req: Request): Promise<Response> => {
    if (req.method !== 'POST' || !identity) return handler.fetch(req);
    const authInfo: AuthInfo = {
      token: '[redacted]',
      clientId: identity.clientId,
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: identity.userId ? { userId: identity.userId, email: 'owner@enu-tech.co.kr' } : {},
    };
    return handler.fetch(req, { authInfo });
  };
  const inProcessFetch: FetchLike = (url, init) => route(new Request(url, init));
  const client = new Client({ name: 'enu-town-test', version: '0.0.1' }, { versionNegotiation: { mode } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), { fetch: inProcessFetch }),
  );
  // Caches the advertised outputSchemas so the client validates every structuredContent against
  // the JSON Schema (additionalProperties: false, date-time formats) like a strict real client.
  await client.listTools();
  return client;
}

export interface ToolCallOutcome {
  isError: boolean;
  texts: string[];
  structured: Record<string, unknown> | undefined;
  raw: unknown;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolCallOutcome> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
    structuredContent?: unknown;
  };
  return {
    isError: res.isError === true,
    texts: (res.content ?? []).flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : [])),
    structured: res.structuredContent as Record<string, unknown> | undefined,
    raw: res,
  };
}

export interface ErrorPayload {
  error: string;
  message: string;
  problems?: { index?: number; field: string; reason: string; detail?: string }[];
  retry_after_seconds?: number;
}

/** Error results are "<message>\n<json>". */
export function errorPayload(outcome: ToolCallOutcome): ErrorPayload {
  const text = outcome.texts.join('\n');
  const json = text.slice(text.indexOf('\n') + 1);
  return JSON.parse(json) as ErrorPayload;
}
