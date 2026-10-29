import { describe, expect, it } from 'vitest';
import { checkEmailAllowed, checkGoogleProfile } from '../src/domain-guard';
import { classifyClient } from '../src/links';
import { hostAllowed } from '../src/create-auth';
import { protectedResourceMetadataUrl } from '../src/mcp-caller';

const policy = { allowedHd: 'enu-tech.co.kr', allowedEmails: [] as string[] };

describe('domain guard', () => {
  it('accepts only the workspace domain', () => {
    expect(checkEmailAllowed('kim@enu-tech.co.kr', policy).ok).toBe(true);
    expect(checkEmailAllowed('kim@ENU-TECH.CO.KR', policy).ok).toBe(true);
    expect(checkEmailAllowed('kim@gmail.com', policy).ok).toBe(false);
    expect(checkEmailAllowed('kim@enu-tech.co.kr.evil.com', policy).ok).toBe(false);
    expect(checkEmailAllowed(null, policy).ok).toBe(false);
  });

  it('honours the pilot allow-list', () => {
    const pilot = { ...policy, allowedEmails: ['a@enu-tech.co.kr'] };
    expect(checkEmailAllowed('a@enu-tech.co.kr', pilot).ok).toBe(true);
    expect(checkEmailAllowed('b@enu-tech.co.kr', pilot).ok).toBe(false);
  });

  it('requires the verified hd claim and email_verified on Google profiles', () => {
    expect(
      checkGoogleProfile({ hd: 'enu-tech.co.kr', email: 'a@enu-tech.co.kr', email_verified: true }, policy)
        .ok,
    ).toBe(true);
    expect(checkGoogleProfile({ email: 'a@enu-tech.co.kr', email_verified: true }, policy).ok).toBe(false);
    expect(
      checkGoogleProfile({ hd: 'other.com', email: 'a@enu-tech.co.kr', email_verified: true }, policy).ok,
    ).toBe(false);
    expect(
      checkGoogleProfile({ hd: 'enu-tech.co.kr', email: 'a@enu-tech.co.kr', email_verified: false }, policy)
        .ok,
    ).toBe(false);
  });
});

describe('client helpers', () => {
  it('classifies Claude clients', () => {
    expect(classifyClient('https://claude.ai/oauth/x', 'https://claude.ai/api/mcp/auth_callback')).toBe(
      'claude_ai',
    );
    expect(classifyClient('https://claude.ai/oauth/claude-code', 'http://localhost:51234/callback')).toBe(
      'claude_code',
    );
    expect(classifyClient('https://example.com/c', 'https://example.com/cb')).toBe('other');
  });

  it('allows CIMD documents only from https allow-listed hosts', () => {
    const hosts = ['claude.ai', 'anthropic.com'];
    expect(hostAllowed('https://claude.ai/oauth/meta.json', hosts)).toBe(true);
    expect(hostAllowed('https://api.anthropic.com/x', hosts)).toBe(true);
    expect(hostAllowed('http://claude.ai/x', hosts)).toBe(false);
    expect(hostAllowed('https://claude.ai.evil.com/x', hosts)).toBe(false);
  });

  it('derives the protected resource metadata url', () => {
    expect(protectedResourceMetadataUrl('https://den.enu-tech.co.kr/api/mcp')).toBe(
      'https://den.enu-tech.co.kr/.well-known/oauth-protected-resource/api/mcp',
    );
  });
});
