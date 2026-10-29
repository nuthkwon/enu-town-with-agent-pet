import type { ApiError } from '@enu/shared';
import { ko } from '@/i18n/ko';

/** Browser fetch wrapper for /api/v1 (same-origin cookies; JSON in, JSON out). */

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: { field: string; reason: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch {
    throw new ApiRequestError(0, 'network_error', ko.common.networkError);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(res.status, err.error ?? 'http_error', err.message ?? ko.common.unknownError, err.fields ?? []);
  }
  return data as T;
}

/** Korean, user-facing description of an API error (with field reasons when present). */
export function describeError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.fields.length) {
      const reasons = e.fields.map((f) => `${f.field}: ${ko.fieldReason[f.reason] ?? f.reason}`);
      return `${e.message} (${reasons.join(', ')})`;
    }
    return e.message;
  }
  return ko.common.unknownError;
}
