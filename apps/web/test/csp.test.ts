import { describe, expect, it } from 'vitest';
import { buildCsp, realtimeOrigins, redirectOrigin } from '@/lib/csp';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('buildCsp', () => {
  it('uses a nonce with strict-dynamic and no unsafe-eval in production', () => {
    const csp = buildCsp({
      nonce: 'abc123',
      dev: false,
      realtimeUrl: 'wss://town.enu-tech.co.kr/colyseus',
      upgradeInsecureRequests: true,
    });
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob:");
    expect(directive(csp, 'font-src')).toBe("font-src 'self'");
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' wss://town.enu-tech.co.kr https://town.enu-tech.co.kr",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(directive(csp, 'form-action')).toBe("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('adds unsafe-eval and the HMR socket in development', () => {
    const csp = buildCsp({
      nonce: 'n',
      dev: true,
      realtimeUrl: 'ws://localhost:2567',
      selfOrigin: 'http://localhost:3000',
    });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' ws://localhost:2567 http://localhost:2567 ws://localhost:3000 http://localhost:3000",
    );
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('allows the OAuth redirect origin as a form target on consent', () => {
    const csp = buildCsp({ nonce: 'n', dev: false, formActionOrigins: ['https://claude.ai'] });
    expect(directive(csp, 'form-action')).toBe("form-action 'self' https://claude.ai");
  });
});

describe('origin helpers', () => {
  it('derives realtime origins', () => {
    expect(realtimeOrigins('ws://localhost:2567')).toEqual(['ws://localhost:2567', 'http://localhost:2567']);
    expect(realtimeOrigins('https://x.test/colyseus')).toEqual(['wss://x.test', 'https://x.test']);
    expect(realtimeOrigins('nope')).toEqual([]);
    expect(realtimeOrigins(undefined)).toEqual([]);
  });

  it('derives redirect origins only for web URLs', () => {
    expect(redirectOrigin('https://claude.ai/api/mcp/auth_callback')).toBe('https://claude.ai');
    expect(redirectOrigin('http://127.0.0.1:7777/callback')).toBe('http://127.0.0.1:7777');
    expect(redirectOrigin('javascript:alert(1)')).toBeNull();
    expect(redirectOrigin('cursor://callback')).toBeNull();
    expect(redirectOrigin(null)).toBeNull();
  });
});
