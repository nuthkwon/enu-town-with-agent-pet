import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../src/credentials';

/**
 * Runs the committed bundle the way Claude Code does (a 2025-era stdio client) against a fake ENU Den, so what
 * ships is what is tested. CI separately checks that the bundle matches the source.
 */
const BUNDLE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../claude/plugins/enu-den-channel/server/den-channel.mjs',
);
const PET = '11111111-1111-4111-8111-111111111111';
const MSG = '33333333-3333-4333-8333-333333333333';
const TOKEN = `edc_${'B'.repeat(43)}`;

interface FakeDen {
  url: string;
  requests: { path: string; auth: string | null; body: unknown }[];
  close: () => Promise<void>;
}

async function fakeDen(): Promise<FakeDen> {
  const requests: FakeDen['requests'] = [];
  let polls = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      const body: unknown = raw ? JSON.parse(raw) : null;
      requests.push({ path: req.url ?? '', auth: req.headers.authorization ?? null, body });
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url === '/api/v1/pet-channel/poll') {
        polls += 1;
        const out = {
          messages:
            polls === 1
              ? [
                  {
                    message_id: MSG,
                    pet_id: PET,
                    sent_at: '2026-10-29T21:05:00+09:00',
                    text: '이 PR 같이 볼래?',
                    visibility: 'company',
                    replies_so_far: 0,
                  },
                ]
              : [],
          pets: [
            {
              pet_id: PET,
              name: '코코',
              is_default: true,
              reply_route: 'both',
              default_visibility: 'company',
              role_instructions: '코드 리뷰를 도와줘.',
            },
          ],
          token_expires_at: '2027-01-27T00:00:00.000Z',
        };
        // A parked poll: answer later than at once, like the real long-poll.
        setTimeout(() => send(200, out), polls === 1 ? 0 : 300);
        return;
      }
      if (req.url === '/api/v1/pet-channel/replies') {
        send(201, {
          result: 'created',
          message_id: '44444444-4444-4444-8444-444444444444',
          visibility: 'company',
        });
        return;
      }
      send(404, { error: 'not_found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

let home: string;
let den: FakeDen;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'enu-den-channel-home-'));
  den = await fakeDen();
});
afterEach(async () => {
  await den.close();
  rmSync(home, { recursive: true, force: true });
});

async function connect(env: Record<string, string>) {
  const notifications: { method: string; params?: unknown }[] = [];
  const client = new Client(
    { name: 'claude-code', version: '2.1.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  client.fallbackNotificationHandler = async (n) => {
    notifications.push({ method: n.method, params: n.params });
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE],
    env: { ...getDefaultEnvironment(), ENU_DEN_URL: den.url, ENU_DEN_CHANNEL_HOME: home, ...env },
    stderr: 'pipe',
  });
  await client.connect(transport);
  return { client, notifications };
}

describe('den-channel.mjs over stdio', () => {
  it('does nothing outside a pet session: no channel, no tools, no network', async () => {
    saveCredentials(join(home, 'credentials.json'), {
      v: 1,
      base_url: den.url,
      token: TOKEN,
      token_id: 't',
      link_id: 'l',
      owner_display_name: '김이누',
      expires_at: '2027-01-27T00:00:00.000Z',
      paired_at: '2026-10-29T00:00:00.000Z',
    });
    const { client } = await connect({});
    const caps = client.getServerCapabilities();
    expect(caps?.experimental).toBeUndefined();
    expect(caps?.tools).toBeUndefined();
    await new Promise((r) => setTimeout(r, 300));
    expect(den.requests).toEqual([]);
    await client.close();
  });

  it('pushes the pet role and the message, and posts the reply as part 1', async () => {
    saveCredentials(join(home, 'credentials.json'), {
      v: 1,
      base_url: den.url,
      token: TOKEN,
      token_id: 't',
      link_id: 'l',
      owner_display_name: '김이누',
      expires_at: '2027-01-27T00:00:00.000Z',
      paired_at: '2026-10-29T00:00:00.000Z',
    });
    const { client, notifications } = await connect({ ENU_DEN_PET: '1' });
    expect(client.getServerCapabilities()?.experimental).toEqual({ 'claude/channel': {} });
    expect(client.getServerCapabilities()?.experimental).not.toHaveProperty(['claude/channel/permission']);
    expect(client.getInstructions()).toContain('ask the owner in this terminal');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['reply', 'status']);
    expect(JSON.stringify(tools)).not.toContain('requiresUserInteraction');

    await vi.waitFor(() => expect(notifications).toHaveLength(2), { timeout: 5000, interval: 50 });
    expect(notifications).toEqual([
      {
        method: 'notifications/claude/channel',
        params: {
          content: '코드 리뷰를 도와줘.',
          meta: { kind: 'pet_role', pet_id: PET, pet_name: '코코', default_visibility: 'company' },
        },
      },
      {
        method: 'notifications/claude/channel',
        params: {
          content: '이 PR 같이 볼래?',
          meta: {
            kind: 'message',
            pet_id: PET,
            pet_name: '코코',
            message_id: MSG,
            sent_at: '2026-10-29T21:05:00+09:00',
            visibility: 'company',
          },
        },
      },
    ]);
    expect(den.requests[0]).toMatchObject({
      path: '/api/v1/pet-channel/poll',
      auth: `Bearer ${TOKEN}`,
      body: { wait_s: 25, plugin_version: '0.1.0', include_held: true },
    });

    const result = (await client.callTool({
      name: 'reply',
      arguments: { pet_id: PET, in_reply_to: MSG, text: '좋아요, 같이 봐요!' },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("펫 '코코' 대화방에 답을 올렸어요");
    expect(den.requests.find((r) => r.path === '/api/v1/pet-channel/replies')?.body).toEqual({
      in_reply_to: MSG,
      part: 1,
      text: '좋아요, 같이 봐요!',
    });
    const status = (await client.callTool({ name: 'status', arguments: {} })) as {
      content: { text: string }[];
    };
    expect(status.content[0]!.text).not.toContain(TOKEN);
    await client.close();
  });

  it('tells an unpaired session how to pair, without any tool to do it', async () => {
    const { client, notifications } = await connect({ ENU_DEN_PET: '1' });
    await vi.waitFor(() => expect(notifications).toHaveLength(1), { timeout: 5000, interval: 50 });
    expect(notifications[0]).toMatchObject({
      params: { meta: { kind: 'notice', code: 'not_paired' } },
    });
    expect((notifications[0]!.params as { content: string }).content).toContain('enu-pet pair');
    expect(den.requests).toEqual([]);
    await client.close();
  });
});
