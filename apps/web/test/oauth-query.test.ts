import { describe, expect, it } from 'vitest';
import { isLoopbackHost, safeNextPath, signedOAuthQuery, toSearchParams } from '@/lib/oauth-query';

describe('signedOAuthQuery', () => {
  it('keeps only the signed parameters', () => {
    const q =
      'client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&exp=1&ba_iat=2&error=x&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=redirect_uri&sig=abc';
    const out = new URLSearchParams(signedOAuthQuery(`?${q}`)!);
    expect(out.get('client_id')).toBe('c1');
    expect(out.get('redirect_uri')).toBe('https://claude.ai/cb');
    expect(out.get('sig')).toBe('abc');
    expect(out.getAll('ba_param')).toHaveLength(5);
    expect(out.has('error')).toBe(false);
  });

  it('returns null without a signature', () => {
    expect(signedOAuthQuery('client_id=c1')).toBeNull();
    expect(signedOAuthQuery('sig=abc')).toBeNull();
    expect(signedOAuthQuery('')).toBeNull();
  });

  it('rebuilds repeated keys from Next searchParams', () => {
    expect(toSearchParams({ a: '1', b: ['2', '3'], c: undefined }).toString()).toBe('a=1&b=2&b=3');
  });
});

describe('safeNextPath', () => {
  it('only allows same-site relative paths', () => {
    expect(safeNextPath('/me?tab=logs')).toBe('/me?tab=logs');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('/sign-in')).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(['/admin', '/me'])).toBe('/admin');
  });
});

describe('isLoopbackHost', () => {
  it('detects loopback redirect hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('claude.ai')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.example')).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
  });
});
