import {
  petChannelPairOutput,
  petChannelPollOutput,
  petChannelReplyOutput,
  type PetChannelPairInput,
  type PetChannelPairOutput,
  type PetChannelPollOutput,
  type PetChannelReplyInput,
  type PetChannelReplyOutput,
} from '@enu/shared';
import type * as z from 'zod';

/** An ENU Den answer other than success: the HTTP status and the API error code (never the token). */
export class ChannelHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string | undefined,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(`ENU Den answered ${status} ${code}`);
    this.name = 'ChannelHttpError';
  }

  /** The token no longer works: pair again. */
  get unpaired(): boolean {
    return this.status === 401;
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The HTTP side of the channel: `/api/v1/pet-channel/*` with the machine's bearer token. Responses are validated
 * with the same zod schemas the web routes use. The tests and the e2e fake channel use this class too.
 */
export class PetChannelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  pair(input: PetChannelPairInput, signal?: AbortSignal): Promise<PetChannelPairOutput> {
    return this.request('POST', '/api/v1/pet-channel/pair', input, petChannelPairOutput, signal, false);
  }

  poll(
    input: { wait_s: number; plugin_version: string; include_held: boolean },
    signal?: AbortSignal,
  ): Promise<PetChannelPollOutput> {
    return this.request('POST', '/api/v1/pet-channel/poll', input, petChannelPollOutput, signal);
  }

  reply(input: PetChannelReplyInput, signal?: AbortSignal): Promise<PetChannelReplyOutput> {
    return this.request('POST', '/api/v1/pet-channel/replies', input, petChannelReplyOutput, signal);
  }

  async unpair(signal?: AbortSignal): Promise<void> {
    await this.request('DELETE', '/api/v1/pet-channel/token', undefined, null, signal);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T> | null,
    signal: AbortSignal | undefined,
    auth = true,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth) {
      if (!this.token) throw new ChannelHttpError(401, 'not_paired', undefined, undefined);
      headers.authorization = `Bearer ${this.token}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      let code = `http_${res.status}`;
      let detail: string | undefined;
      try {
        const err = (await res.json()) as { error?: unknown; message?: unknown };
        if (typeof err.error === 'string') code = err.error;
        if (typeof err.message === 'string') detail = err.message;
      } catch {
        // Not JSON (a proxy page): keep the status code.
      }
      const retry = Number(res.headers.get('retry-after'));
      throw new ChannelHttpError(
        res.status,
        code,
        detail,
        Number.isFinite(retry) && retry > 0 ? retry : undefined,
      );
    }
    if (schema === null) return undefined as T;
    return schema.parse(await res.json());
  }
}
