/**
 * Workspace domain policy. Google enforces the verified `hd` claim inside Better Auth
 * (socialProviders.google.hd); these checks are defense in depth on every path that can
 * create a user, sign one in, or authorize an MCP call.
 */

export interface DomainPolicy {
  allowedHd: string;
  /** Optional pilot allow-list (lower-case emails). Empty = everyone in the domain. */
  allowedEmails: readonly string[];
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

export type DomainCheck = { ok: true } | { ok: false; error: string; description: string };

export function checkEmailAllowed(email: string | null | undefined, policy: DomainPolicy): DomainCheck {
  if (!email) return { ok: false, error: 'email_missing', description: '이메일 정보가 없습니다.' };
  if (emailDomain(email) !== policy.allowedHd.toLowerCase()) {
    return {
      ok: false,
      error: 'domain_not_allowed',
      description: `${policy.allowedHd} 계정만 사용할 수 있습니다.`,
    };
  }
  if (policy.allowedEmails.length > 0 && !policy.allowedEmails.includes(email.toLowerCase())) {
    return { ok: false, error: 'not_in_pilot', description: '현재 파일럿 대상이 아닙니다.' };
  }
  return { ok: true };
}

/** Checks the raw Google profile (id-token claims) Better Auth hands to validateUserInfo. */
export function checkGoogleProfile(
  profile: Record<string, unknown> | undefined,
  policy: DomainPolicy,
): DomainCheck {
  if (!profile)
    return { ok: false, error: 'profile_missing', description: 'Google 프로필을 확인할 수 없습니다.' };
  if (profile.hd !== policy.allowedHd) {
    return {
      ok: false,
      error: 'domain_not_allowed',
      description: `${policy.allowedHd} 계정만 사용할 수 있습니다.`,
    };
  }
  if (profile.email_verified !== true && profile.email_verified !== 'true') {
    return { ok: false, error: 'email_not_verified', description: '확인된 이메일이 아닙니다.' };
  }
  return checkEmailAllowed(typeof profile.email === 'string' ? profile.email : null, policy);
}
