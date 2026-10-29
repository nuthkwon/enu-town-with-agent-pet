/** Content-Security-Policy builder used by src/proxy.ts (pure; unit-tested). */

export interface CspOptions {
  nonce: string;
  /** next dev needs 'unsafe-eval' (React debug stacks) and the HMR websocket. */
  dev: boolean;
  /** REALTIME_PUBLIC_URL, e.g. wss://den.enu-tech.co.kr/colyseus or ws://localhost:2567 */
  realtimeUrl?: string | undefined;
  /** Extra form-action origins (the OAuth redirect_uri origin on /consent). */
  formActionOrigins?: readonly string[];
  /** Origin of the page itself (used for the dev HMR websocket). */
  selfOrigin?: string | undefined;
  upgradeInsecureRequests?: boolean;
}

/** ws(s) origin plus its http(s) twin (Colyseus matchmaking uses HTTP before the socket). */
export function realtimeOrigins(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const u = new URL(url);
    const host = u.host;
    if (u.protocol === 'ws:' || u.protocol === 'http:') return [`ws://${host}`, `http://${host}`];
    if (u.protocol === 'wss:' || u.protocol === 'https:') return [`wss://${host}`, `https://${host}`];
    return [];
  } catch {
    return [];
  }
}

/** Origin of an OAuth redirect_uri when it is a web URL (http/https); null otherwise. */
export function redirectOrigin(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp(o: CspOptions): string {
  const connect = new Set<string>(["'self'", ...realtimeOrigins(o.realtimeUrl)]);
  if (o.dev && o.selfOrigin) {
    for (const origin of realtimeOrigins(o.selfOrigin)) connect.add(origin);
  }
  const formAction = new Set<string>(["'self'", ...(o.formActionOrigins ?? [])]);
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic'${o.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...connect].join(' ')}`,
    "worker-src 'self' blob:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action ${[...formAction].join(' ')}`,
    "manifest-src 'self'",
  ];
  if (o.upgradeInsecureRequests) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
