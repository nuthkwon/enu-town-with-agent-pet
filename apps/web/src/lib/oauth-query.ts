/**
 * The signed OAuth query that Better Auth's oauth-provider appends to the login/consent page
 * URL (…&ba_param=…&sig=…). Only `sig`, `ba_param` and the parameter names listed in
 * `ba_param` are covered by the signature, so anything else on the page URL (e.g. our own
 * `error=`) must be dropped before verifying or forwarding it as `oauth_query`.
 * Mirrors the provider's client-side buildSignedOAuthQuery (not exported by the package).
 */
export function signedOAuthQuery(search: string | URLSearchParams): string | null {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;
  if (!params.has('sig')) return null;
  const names = new Set(params.getAll('ba_param'));
  if (names.size === 0) return null;
  const out = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (key === 'sig' || key === 'ba_param' || names.has(key)) out.append(key, value);
  }
  return out.toString();
}

/** Rebuilds a query string from Next's `searchParams` object (repeated keys become repeats). */
export function toSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) for (const item of v) out.append(k, item);
    else if (typeof v === 'string') out.append(k, v);
  }
  return out;
}

/**
 * A same-site relative path for ?next= (never an absolute or protocol-relative URL). Control characters are
 * refused anywhere: browsers drop tabs and line breaks from URLs, so `/<tab>/evil.example` would become
 * `//evil.example`.
 */
export function safeNextPath(next: string | string[] | null | undefined, fallback = '/'): string {
  const v = Array.isArray(next) ? next[0] : next;
  // eslint-disable-next-line no-control-regex
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || /[\x00-\x1f\x7f]/.test(v))
    return fallback;
  if (v.startsWith('/sign-in') || v.startsWith('/api/')) return fallback;
  return v;
}

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(h);
}
