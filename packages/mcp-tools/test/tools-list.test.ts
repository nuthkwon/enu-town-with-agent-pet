import type { Db } from '@enu/db';
import { INSTRUCTIONS_VERSION, MCP_TOOL_NAMES } from '@enu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOT_AUTHENTICATED_MESSAGE, callerFromAuthInfo, type RateLimiter } from '../src/index';
import { MODES, callTool, connectClient, createTestHandler, errorPayload } from './harness';

/** Listing tools and the unauthenticated path never touch the database. */
const unusedDb = new Proxy({} as Db, {
  get() {
    throw new Error('database must not be used in this test');
  },
});

const ALL_NAMES = Object.values(MCP_TOOL_NAMES).sort();

describe('callerFromAuthInfo', () => {
  it('reads extra.userId and clientId only', () => {
    expect(
      callerFromAuthInfo({ token: 't', clientId: 'client-1', scopes: ['mcp'], extra: { userId: 'u1', email: 'a@b' } }),
    ).toEqual({ userId: 'u1', clientId: 'client-1' });
    expect(callerFromAuthInfo(undefined)).toBeUndefined();
    expect(callerFromAuthInfo({ token: 't', clientId: 'client-1', scopes: [] })).toBeUndefined();
    expect(callerFromAuthInfo({ token: 't', clientId: '', scopes: [], extra: { userId: 'u1' } })).toBeUndefined();
    expect(callerFromAuthInfo({ token: 't', clientId: 'c', scopes: [], extra: { userId: 42 } })).toBeUndefined();
  });
});

describe.each(MODES)('tools/list (%s negotiation)', (mode) => {
  const handler = createTestHandler({ db: unusedDb, publicUrl: 'https://town.example' });
  let listJson = '';
  let tools: Awaited<ReturnType<Awaited<ReturnType<typeof connectClient>>['listTools']>>['tools'] = [];
  let instructions: string | undefined;
  let serverVersion: string | undefined;

  beforeAll(async () => {
    const client = await connectClient(handler, { userId: 'u-1', clientId: 'client-1' }, mode);
    const listed = await client.listTools();
    tools = listed.tools;
    listJson = JSON.stringify(listed);
    instructions = client.getInstructions();
    serverVersion = client.getServerVersion()?.version;
    await client.close();
  });
  afterAll(async () => {
    await handler.close();
  });

  it('advertises exactly the four ENU Town tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_NAMES);
  });

  it('never sets requiresUserInteraction anywhere', () => {
    expect(listJson).not.toContain('requiresUserInteraction');
    expect(instructions ?? '').not.toContain('requiresUserInteraction');
  });

  it('sends instructions and the instructions version', () => {
    expect(instructions).toContain('get_my_context first');
    expect(serverVersion).toBe(INSTRUCTIONS_VERSION);
  });

  it('marks get_my_context read-only and the writes as non-destructive idempotent', () => {
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get(MCP_TOOL_NAMES.getMyContext)?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    for (const name of [MCP_TOOL_NAMES.postWorkLog, MCP_TOOL_NAMES.upsertTodos, MCP_TOOL_NAMES.postPetNudges]) {
      expect(byName.get(name)?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('publishes input and output schemas from @enu/shared', () => {
    const byName = new Map(tools.map((t) => [t.name, t]));
    const required = (name: string) => (byName.get(name)?.inputSchema as { required?: string[] }).required ?? [];
    const props = (name: string) => Object.keys((byName.get(name)?.inputSchema as { properties?: object }).properties ?? {});
    expect(required(MCP_TOOL_NAMES.getMyContext)).toEqual([]);
    expect(props(MCP_TOOL_NAMES.getMyContext)).toEqual(expect.arrayContaining(['include', 'since']));
    expect(required(MCP_TOOL_NAMES.postWorkLog)).toContain('summary');
    expect(props(MCP_TOOL_NAMES.postWorkLog)).toEqual(
      expect.arrayContaining(['summary', 'tasks', 'blockers', 'claude_chat_summary', 'visibility', 'source_hint']),
    );
    expect(required(MCP_TOOL_NAMES.upsertTodos)).toContain('items');
    expect(required(MCP_TOOL_NAMES.postPetNudges)).toContain('nudges');
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(100);
      // Tools never take a user id: identity comes only from the verified token.
      expect(JSON.stringify(t.inputSchema)).not.toMatch(/user_?id/i);
    }
    const nudgeItems = (byName.get(MCP_TOOL_NAMES.postPetNudges)?.inputSchema as unknown as {
      properties: { nudges: { items: { required?: string[] } } };
    }).properties.nudges.items;
    expect(nudgeItems.required).toContain('text');
  });

  it('descriptions state the verbatim/reject and untrusted-data rules', () => {
    const byName = new Map(tools.map((t) => [t.name, t.description ?? '']));
    expect(byName.get(MCP_TOOL_NAMES.getMyContext)).toMatch(/untrusted/);
    expect(byName.get(MCP_TOOL_NAMES.postWorkLog)).toMatch(/cumulative/);
    expect(byName.get(MCP_TOOL_NAMES.postWorkLog)).toMatch(/REJECTS \(does not edit\)/);
    expect(byName.get(MCP_TOOL_NAMES.postPetNudges)).toMatch(/Only the owner sees them/);
  });
});

describe.each(MODES)('authentication and rate limiting without a database (%s)', (mode) => {
  it('returns isError "not authenticated" for every tool when the caller is missing', async () => {
    const handler = createTestHandler({ db: unusedDb, publicUrl: 'https://town.example' });
    for (const identity of [null, { clientId: 'client-without-user' }]) {
      const client = await connectClient(handler, identity, mode);
      const calls: [string, Record<string, unknown>][] = [
        [MCP_TOOL_NAMES.getMyContext, {}],
        [MCP_TOOL_NAMES.postWorkLog, { summary: '오늘 견적서를 검토했습니다.' }],
        [MCP_TOOL_NAMES.upsertTodos, { items: [{ external_ref: 'jira:ENU-1', title: '견적서 검토' }] }],
        [MCP_TOOL_NAMES.postPetNudges, { nudges: [{ text: '견적서 검토 잊지 마세요!' }] }],
      ];
      for (const [name, args] of calls) {
        const out = await callTool(client, name, args);
        expect(out.isError, name).toBe(true);
        expect(out.texts[0]?.startsWith(NOT_AUTHENTICATED_MESSAGE), name).toBe(true);
        expect(errorPayload(out).error).toBe('not_authenticated');
      }
      await client.close();
    }
    await handler.close();
  });

  it('returns isError with retry_after_seconds when the limiter refuses (before any DB access)', async () => {
    const refuse: RateLimiter = { consume: () => ({ ok: false, retryAfterSeconds: 1234 }) };
    const handler = createTestHandler({ db: unusedDb, publicUrl: 'https://town.example', rateLimiter: refuse });
    const client = await connectClient(handler, { userId: 'u-1', clientId: 'client-1' }, mode);
    const out = await callTool(client, MCP_TOOL_NAMES.getMyContext, {});
    expect(out.isError).toBe(true);
    expect(out.texts[0]).toContain('retry after 1234 seconds');
    expect(errorPayload(out)).toMatchObject({ error: 'rate_limited', retry_after_seconds: 1234 });
    await client.close();
    await handler.close();
  });

  it('rejects malformed input through the shared zod schema', async () => {
    const handler = createTestHandler({ db: unusedDb, publicUrl: 'https://town.example' });
    const client = await connectClient(handler, null, mode);
    const out = await callTool(client, MCP_TOOL_NAMES.postPetNudges, { nudges: [] });
    expect(out.isError).toBe(true);
    expect(out.texts.join(' ')).toMatch(/Input validation error/);
    await client.close();
    await handler.close();
  });
});
