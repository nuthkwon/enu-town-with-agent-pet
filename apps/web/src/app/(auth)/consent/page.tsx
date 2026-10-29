import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/SiteHeader';
import { Notice } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { isLoopbackHost, signedOAuthQuery, toSearchParams } from '@/lib/oauth-query';
import { lookupClient, verifyConsentQuery } from '@/server/consent';
import { getPageViewer } from '@/server/page-session';
import { decideConsent, switchAccount } from './actions';
import { ConsentButtons, SwitchAccountButton } from './ConsentButtons';
import s from './consent.module.css';

export const metadata: Metadata = { title: ko.consent.title };

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = toSearchParams(await searchParams);
  const signed = signedOAuthQuery(sp);
  const viewer = await getPageViewer();
  if (!viewer) redirect(`/sign-in${signed ? `?${signed}` : ''}`);

  const params = signed ? await verifyConsentQuery(signed) : null;
  if (!params || !signed) {
    return (
      <div className={s.card}>
        <Logo />
        <h1 className={s.title}>{ko.consent.invalidTitle}</h1>
        <Notice tone="error">{ko.consent.invalidBody}</Notice>
      </div>
    );
  }

  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri');
  const redirectHost = hostOf(redirectUri);
  const client = await lookupClient(clientId);
  const clientName = client.name ?? client.clientIdHost ?? ko.consent.unknownClient;
  const loopback = isLoopbackHost(redirectHost?.replace(/:\d+$/, ''));
  const failed = sp.get('enu_error');

  return (
    <div className={s.card}>
      <div className={s.top}>
        <Logo />
      </div>
      <div className={s.hero}>
        <span className={s.plug} aria-hidden="true">
          <span>Claude</span>
          <span className={s.plugDots}>· · ✦ · ·</span>
          <span>{ko.app.name}</span>
        </span>
        <h1 className={s.title}>{ko.consent.title}</h1>
        <p className={s.lead}>{ko.consent.lead(clientName)}</p>
      </div>

      {failed && (
        <Notice tone="error">{failed === 'invalid' ? ko.consent.invalidBody : ko.consent.failed}</Notice>
      )}

      <div className={s.account}>
        <div>
          <div className={s.kicker}>{ko.consent.connectingAs}</div>
          <div className={s.email}>{viewer.email}</div>
        </div>
        <form action={switchAccount}>
          <input type="hidden" name="oauth_query" value={signed} />
          <SwitchAccountButton />
        </form>
      </div>

      <dl className={s.meta}>
        <div>
          <dt>{ko.consent.redirectTo}</dt>
          <dd>{redirectHost ?? '-'}</dd>
        </div>
        <div>
          <dt>{ko.consent.clientId}</dt>
          <dd className={s.mono}>{client.clientIdHost ?? clientId}</dd>
        </div>
      </dl>

      {loopback && (
        <Notice tone="warn" title={ko.consent.loopbackTitle}>
          {ko.consent.loopbackBody}
        </Notice>
      )}

      <div className={s.lists}>
        <div className={s.listCan}>
          <h2>{ko.consent.canTitle}</h2>
          <ul>
            {ko.consent.can.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className={s.listCannot}>
          <h2>{ko.consent.cannotTitle}</h2>
          <ul>
            {ko.consent.cannot.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className={s.privacy}>
        {ko.consent.privacy}{' '}
        <Link href="/privacy" target="_blank">
          {ko.consent.privacyLink}
        </Link>
      </p>

      <form action={decideConsent} className={s.actions}>
        <input type="hidden" name="oauth_query" value={signed} />
        <ConsentButtons />
      </form>
    </div>
  );
}
