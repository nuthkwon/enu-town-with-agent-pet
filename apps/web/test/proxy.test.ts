import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '@/proxy';

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, 'http://localhost:3000'), { headers: cookie ? { cookie } : {} });

describe('proxy', () => {
  it('sends signed-out visitors of app pages to /sign-in with next', () => {
    for (const path of ['/town', '/me?tab=logs', '/admin', '/welcome']) {
      const res = proxy(req(path));
      expect(res.status, path).toBe(307);
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/sign-in');
      expect(location.searchParams.get('next')).toBe(path);
    }
  });

  it('lets public pages and session holders through with a per-request CSP nonce', () => {
    const a = proxy(req('/sign-in'));
    const b = proxy(req('/town', 'better-auth.session_token=abc.def'));
    for (const res of [a, b]) {
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('content-security-policy')).toMatch(
        /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
      );
    }
    const nonceOf = (r: Response) => r.headers.get('content-security-policy')!.match(/'nonce-([^']+)'/)![1];
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  it('allows the OAuth client origin as a form target only on /consent', () => {
    const q = `?redirect_uri=${encodeURIComponent('https://claude.ai/api/mcp/auth_callback')}`;
    expect(proxy(req(`/consent${q}`)).headers.get('content-security-policy')).toContain(
      "form-action 'self' https://claude.ai",
    );
    expect(proxy(req(`/sign-in${q}`)).headers.get('content-security-policy')).toContain(
      "form-action 'self';",
    );
    const js = `?redirect_uri=${encodeURIComponent('javascript:alert(1)')}`;
    expect(proxy(req(`/consent${js}`)).headers.get('content-security-policy')).toContain(
      "form-action 'self';",
    );
  });

  it('does not run on API, discovery or static paths', () => {
    const source = config.matcher[0]!.source;
    const re = new RegExp(`^${source}$`);
    for (const path of [
      '/api/mcp',
      '/api/v1/me',
      '/.well-known/oauth-protected-resource/api/mcp',
      '/_next/static/x.js',
      '/assets/sprites/pets/cat.png',
    ]) {
      expect(re.test(path), path).toBe(false);
    }
    for (const path of ['/town', '/sign-in', '/consent', '/']) expect(re.test(path), path).toBe(true);
  });
});
