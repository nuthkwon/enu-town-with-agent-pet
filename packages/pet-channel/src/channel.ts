import {
  LIMITS,
  type ChannelReplyToolInput,
  type PetChannelPet,
  type PetChannelPollOutput,
  type Visibility,
} from '@enu/shared';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { ChannelHttpError, type PetChannelClient } from './client';
import { NOTICES, type NoticeCode } from './instructions';
import { roleFingerprint, sanitizeMetaValue } from './meta';
import { PLUGIN_VERSION } from './version';

/** One `notifications/claude/channel` event: the body Claude reads and the tag attributes. */
export type ChannelEvent = {
  content: string;
  meta: Record<string, string>;
};

/** A tool result in the same shape as the ENU Den connector's: a Korean line plus the JSON copy. */
export type ToolResult = CallToolResult;

export interface PetChannelDeps {
  /** Null while unpaired; `reloadClient` is asked again every minute. */
  client: Pick<PetChannelClient, 'poll' | 'reply'> | null;
  reloadClient: () => Pick<PetChannelClient, 'poll' | 'reply'> | null;
  emit: (event: ChannelEvent) => Promise<void>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  /** Diagnostics on stderr: codes only, never a token, a message or a name. */
  log?: (code: string) => void;
}

const POLL_WAIT_S = 25;
/** The request gives up a little after the server's longest wait. */
const POLL_TIMEOUT_MS = 35_000;
const UNPAIRED_RECHECK_MS = 60_000;
const NOTICE_RETRY_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 60_000;
const EXPIRY_WARNING_MS = 7 * 86_400_000;

const VISIBILITY_KO: Record<Visibility, string> = {
  company: '전사 공개(동료도 날짜와 함께 볼 수 있어요)',
  private: '나만 보기',
};

function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Aborts when any of `signals` does (AbortSignal.any is missing on older Node versions). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

function textResult(summary: string, json: unknown, isError = false): ToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(json)}` }],
  };
}

/** Text problems: rewrite and send again. Anything else: do not retry. */
const REWRITE = new Set(['pii', 'url', 'too_long', 'empty']);

/**
 * The live half of the plugin: a long-poll loop that pushes the owner's pet messages into the session (each pet's
 * role first), and the `reply` and `status` tools. One instance per Claude Code session.
 */
export class PetChannel {
  private client: PetChannelDeps['client'];
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly log: (code: string) => void;
  private readonly stopper = new AbortController();
  private readonly pets = new Map<string, PetChannelPet>();
  private readonly roleSent = new Map<string, string>();
  /** Messages pushed into this session: their pet and the reply parts stored so far. */
  private readonly delivered = new Map<string, { petId: string; parts: number; answered: boolean }>();
  private readonly noticesSent = new Set<NoticeCode>();
  private tokenExpiresAt: string | null = null;
  private running = false;

  constructor(private readonly deps: PetChannelDeps) {
    this.client = deps.client;
    this.sleep = deps.sleep ?? sleepFor;
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.log = deps.log ?? (() => undefined);
  }

  get paired(): boolean {
    return this.client !== null;
  }

  stop(): void {
    this.stopper.abort();
  }

  /** Polls until `stop()`. Never throws. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const signal = this.stopper.signal;
    let first = true;
    let backoff = 1000;
    while (!signal.aborted) {
      if (!this.client) {
        if (!this.noticesSent.has('unpaired')) await this.notice('not_paired');
        await this.sleep(UNPAIRED_RECHECK_MS, signal);
        this.client = this.deps.reloadClient();
        if (this.client) {
          this.noticesSent.clear();
          await this.notice('resumed');
          first = true;
        }
        continue;
      }
      const timeout = AbortSignal.timeout(POLL_TIMEOUT_MS);
      try {
        const out = await this.client.poll(
          { wait_s: POLL_WAIT_S, plugin_version: PLUGIN_VERSION, include_held: first },
          anySignal([signal, timeout]),
        );
        first = false;
        backoff = 1000;
        await this.accept(out);
      } catch (e) {
        if (signal.aborted) break;
        if (e instanceof ChannelHttpError) {
          this.log(`poll_${e.status}_${e.code}`);
          if (e.status === 401) {
            this.client = null;
            await this.notice('unpaired');
            continue;
          }
          if (e.status === 403) {
            await this.notice('notice_required');
            await this.sleep(NOTICE_RETRY_MS, signal);
            continue;
          }
          if (e.status === 429) {
            await this.sleep((e.retryAfterSeconds ?? 60) * 1000, signal);
            continue;
          }
        } else {
          this.log(timeout.aborted ? 'poll_timeout' : 'poll_network');
        }
        await this.sleep(backoff * (0.8 + this.random() * 0.4), signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
    this.running = false;
  }

  /** Pushes one poll result into the session: a pet's role before its first message and whenever it changes. */
  async accept(out: PetChannelPollOutput): Promise<void> {
    this.tokenExpiresAt = out.token_expires_at;
    for (const pet of out.pets) {
      this.pets.set(pet.pet_id, pet);
      const sent = this.roleSent.get(pet.pet_id);
      if (sent !== undefined && sent !== roleFingerprint(pet.role_instructions)) await this.sendRole(pet);
    }
    for (const m of out.messages) {
      if (this.delivered.has(m.message_id)) continue;
      const pet = this.pets.get(m.pet_id);
      if (pet && !this.roleSent.has(pet.pet_id)) await this.sendRole(pet);
      this.delivered.set(m.message_id, { petId: m.pet_id, parts: m.replies_so_far, answered: false });
      await this.deps.emit({
        content: m.text,
        meta: {
          kind: 'message',
          pet_id: m.pet_id,
          pet_name: sanitizeMetaValue(pet?.name ?? '펫', 20),
          message_id: m.message_id,
          sent_at: m.sent_at,
          visibility: m.visibility,
        },
      });
    }
    const expires = Date.parse(out.token_expires_at);
    if (Number.isFinite(expires) && expires - this.now().getTime() < EXPIRY_WARNING_MS) {
      await this.notice('expiring_soon');
    }
  }

  private async sendRole(pet: PetChannelPet): Promise<void> {
    this.roleSent.set(pet.pet_id, roleFingerprint(pet.role_instructions));
    await this.deps.emit({
      content: pet.role_instructions ?? '(역할 지시문 없음)',
      meta: {
        kind: 'pet_role',
        pet_id: pet.pet_id,
        pet_name: sanitizeMetaValue(pet.name, 20),
        default_visibility: pet.default_visibility,
      },
    });
  }

  private async notice(code: NoticeCode): Promise<void> {
    if (this.noticesSent.has(code)) return;
    this.noticesSent.add(code);
    try {
      await this.deps.emit({ content: NOTICES[code], meta: { kind: 'notice', code } });
    } catch {
      this.log('notice_failed');
    }
  }

  /** The `reply` tool. */
  async reply(input: ChannelReplyToolInput): Promise<ToolResult> {
    if (!this.client) {
      return textResult(NOTICES.unpaired, { error: 'not_paired' }, true);
    }
    const id = input.in_reply_to.toLowerCase();
    const known = this.delivered.get(id);
    if (known && known.petId !== input.pet_id.toLowerCase()) {
      return textResult(
        '이 메시지는 다른 펫에게 온 메시지예요. 태그의 pet_id와 message_id를 그대로 써 주세요.',
        { error: 'pet_mismatch' },
        true,
      );
    }
    const part = (known?.parts ?? 0) + 1;
    if (part > LIMITS.petRepliesPerMessageMax) {
      return textResult(
        `한 메시지에는 답을 ${LIMITS.petRepliesPerMessageMax}번까지만 이어 보낼 수 있어요.`,
        { error: 'too_many_parts' },
        true,
      );
    }
    try {
      const out = await this.client.reply({
        in_reply_to: id,
        part,
        text: input.text,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      });
      const name = this.pets.get(input.pet_id.toLowerCase())?.name ?? '펫';
      if (out.result === 'skipped_owner_deleted') {
        this.delivered.delete(id);
        return textResult('주인이 이 메시지를 지워서 답을 올리지 않았어요. 다시 보내지 마세요.', out);
      }
      if (known) {
        known.parts = part;
        known.answered = true;
      }
      if (out.result === 'duplicate') return textResult('이미 올린 답이에요. 바뀐 것은 없어요.', out);
      return textResult(
        `펫 '${name}' 대화방에 답을 올렸어요(공개 범위: ${VISIBILITY_KO[out.visibility ?? 'private']}).`,
        out,
      );
    } catch (e) {
      if (!(e instanceof ChannelHttpError)) {
        this.log('reply_network');
        return textResult(
          'ENU Den에 연결하지 못했어요. 잠시 후 한 번만 다시 시도해 주세요.',
          { error: 'network' },
          true,
        );
      }
      if (e.unpaired) {
        this.client = null;
        return textResult(NOTICES.unpaired, { error: e.code }, true);
      }
      if (REWRITE.has(e.code)) {
        return textResult(
          'ENU Den이 이 답을 거절했어요(문구는 고치지 않아요). reason을 보고 다시 써서 한 번 더 보내 주세요.',
          { error: 'rejected', reason: e.code, ...(e.detail ? { detail: e.detail } : {}) },
          true,
        );
      }
      if (known && e.code === 'already_answered') known.answered = true;
      return textResult(
        '이 메시지에는 지금 답할 수 없어요(이미 답했거나 이 펫은 체크인에서만 답해요). 오류가 아니니 다시 보내지 마세요.',
        { error: 'not_answerable', reason: e.code },
        true,
      );
    }
  }

  /** The `status` tool (never the token). */
  status(): ToolResult {
    const waiting = [...this.delivered.values()].filter((d) => !d.answered).length;
    const pets = [...this.pets.values()].map((p) => ({
      pet_id: p.pet_id,
      name: p.name,
      reply_route: p.reply_route,
    }));
    const summary = this.client
      ? `ENU Den에 연결되어 있어요. 펫 ${pets.length}마리, 아직 답하지 않은 메시지 ${waiting}개.`
      : NOTICES.not_paired;
    return textResult(summary, {
      paired: this.client !== null,
      listening: this.running,
      token_expires_at: this.tokenExpiresAt,
      pets,
      waiting,
      plugin_version: PLUGIN_VERSION,
    });
  }
}
