'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signedOAuthQuery } from '@/lib/oauth-query';
import { getAuth } from '@/server/auth';
import { performConsent } from '@/server/consent';

/** Allow / deny on the consent screen. Ends with a redirect to the OAuth client (or back here). */
export async function decideConsent(formData: FormData): Promise<void> {
  const rawQuery = String(formData.get('oauth_query') ?? '');
  const accept = formData.get('decision') === 'allow';
  const outcome = await performConsent({ headers: await headers(), accept, rawQuery });
  if (outcome.kind === 'redirect' || outcome.kind === 'sign_in') redirect(outcome.url);
  redirect(`/consent?${signedOAuthQuery(rawQuery) ?? ''}&enu_error=${outcome.kind}`);
}

/** "다른 계정": sign out, then sign in again with the same signed OAuth request. */
export async function switchAccount(formData: FormData): Promise<void> {
  const rawQuery = String(formData.get('oauth_query') ?? '');
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // Already signed out.
  }
  const signed = signedOAuthQuery(rawQuery);
  redirect(`/sign-in${signed ? `?${signed}` : ''}`);
}
