/**
 * Stands in for the `enu-den-channel` plugin on an employee's PC during the demo: pairs with the code the
 * person made in ENU Den (what `enu-pet pair` does), long-polls for their messages and answers through the
 * channel reply route. The answers are the employee's Claude Code's, written out in the scenario.
 */
export interface ScriptedReply {
  /** A substring of the owner's message this answers. */
  match: string;
  parts: string[];
  /** How long "Claude Code" works before answering. */
  thinkMs: number;
}

const PLUGIN_VERSION = '1.0.0';

export async function pairChannel(baseUrl: string, code: string, label: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/pet-channel/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, platform: 'darwin', plugin_version: PLUGIN_VERSION, label }),
  });
  const body = (await res.json()) as { token?: string };
  if (res.status !== 201 || !body.token)
    throw new Error(`pair failed: ${res.status} ${JSON.stringify(body)}`);
  return body.token;
}

export class FakeClaudeCode {
  private stopped = false;
  private loop: Promise<void> | null = null;
  private readonly answered = new Set<string>();
  readonly log: string[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly script: ScriptedReply[],
  ) {}

  start(): void {
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop?.catch(() => undefined);
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
  }

  private async run(): Promise<void> {
    let first = true;
    while (!this.stopped) {
      const res = await this.post('/api/v1/pet-channel/poll', {
        wait_s: 5,
        plugin_version: PLUGIN_VERSION,
        include_held: first,
      }).catch(() => null);
      first = false;
      if (!res?.ok) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const { messages } = (await res.json()) as { messages: { message_id: string; text: string }[] };
      for (const m of messages) {
        if (this.answered.has(m.message_id)) continue;
        const reply = this.script.find((s) => m.text.includes(s.match));
        if (!reply) continue;
        this.answered.add(m.message_id);
        void this.answer(m.message_id, reply);
      }
    }
  }

  private async answer(messageId: string, reply: ScriptedReply): Promise<void> {
    await new Promise((r) => setTimeout(r, reply.thinkMs));
    for (const [i, text] of reply.parts.entries()) {
      const res = await this.post('/api/v1/pet-channel/replies', {
        in_reply_to: messageId,
        part: i + 1,
        text,
      });
      this.log.push(`${messageId}#${i + 1}: ${res.status}`);
      if (i < reply.parts.length - 1) await new Promise((r) => setTimeout(r, 1800));
    }
  }
}
