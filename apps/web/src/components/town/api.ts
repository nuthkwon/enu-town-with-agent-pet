import type { ApiError } from '@enu/shared';

/** Thin JSON fetch helpers for the town overlays (same-origin, cookie session, no caching). */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`);
    this.name = 'ApiFailure';
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.assign(`/sign-in?next=${encodeURIComponent('/town')}`);
    }
    throw new ApiFailure(res.status, (body as ApiError | null) ?? null);
  }
  return body as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal,
  });
  return parse<T>(res);
}

export async function sendJson<T>(method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}

export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export const api = {
  people: () => '/api/v1/people',
  desks: () => '/api/v1/desks',
  card: (id: string) => `/api/v1/users/${encodeURIComponent(id)}/card`,
  workLogs: (id: string, cursor?: string | null) =>
    withQuery(`/api/v1/users/${encodeURIComponent(id)}/work-logs`, { cursor }),
  chatHistory: (id: string, kind: 'dm' | 'nearby' | 'room', before?: string | null) =>
    withQuery(`/api/v1/users/${encodeURIComponent(id)}/chat-history`, { kind, before }),
  claudeSummaries: (id: string, cursor?: string | null) =>
    withQuery(`/api/v1/users/${encodeURIComponent(id)}/claude-summaries`, { cursor }),
  roomChat: (before?: string | null) => withQuery('/api/v1/chat/room', { before }),
  dmThreads: () => '/api/v1/dm/threads',
  dmConversation: (peerId: string, before?: string | null) =>
    withQuery(`/api/v1/dm/${encodeURIComponent(peerId)}`, { before }),
  myPet: () => '/api/v1/me/pet',
  myTodo: (id: string) => `/api/v1/me/todos/${encodeURIComponent(id)}`,
  myWorkLog: (id: string) => `/api/v1/me/work-logs/${encodeURIComponent(id)}`,
  nudgeAction: (id: string) => `/api/v1/me/nudges/${encodeURIComponent(id)}/actions`,
} as const;
