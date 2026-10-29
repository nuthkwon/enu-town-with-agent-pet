'use client';

import { createAuthClient, oauthProviderClient } from '@enu/auth/client';
import type { AvatarPreset } from '@enu/shared';
import { useState } from 'react';
import { AvatarSprite, PetSprite } from '@/components/sprites';
import { Notice } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { signedOAuthQuery } from '@/lib/oauth-query';
import s from './sign-in.module.css';

export interface DevUser {
  email: string;
  name: string;
  avatar: AvatarPreset;
  avatarKey: string;
  deskId: string | null;
  isAdmin: boolean;
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function SignInPanel({
  hd,
  googleEnabled,
  devLogin,
  devUsers,
  next,
  connectorFlow,
  errorMessage,
  signedOut,
}: {
  hd: string;
  googleEnabled: boolean;
  devLogin: boolean;
  devUsers: DevUser[];
  next: string;
  connectorFlow: boolean;
  errorMessage: string | null;
  signedOut: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(errorMessage);

  async function google() {
    setBusy('google');
    setError(null);
    try {
      // oauthProviderClient forwards the signed OAuth query (connector logins resume after Google).
      const client = createAuthClient({ plugins: [oauthProviderClient()] });
      const res = await client.signIn.social({
        provider: 'google',
        callbackURL: next,
        newUserCallbackURL: connectorFlow ? next : '/welcome',
        errorCallbackURL: '/sign-in',
      });
      if (res.error) {
        setError(ko.signIn.errorDefault);
        setBusy(null);
      }
    } catch {
      setError(ko.signIn.errorDefault);
      setBusy(null);
    }
  }

  async function devSignIn(email: string) {
    setBusy(email);
    setError(null);
    try {
      const oauthQuery = signedOAuthQuery(window.location.search);
      const res = await fetch('/api/auth/dev/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(oauthQuery ? { email, oauth_query: oauthQuery } : { email }),
      });
      const data = (await res.json().catch(() => null)) as {
        redirect?: boolean;
        url?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        setError(data?.message ?? ko.signIn.errorDefault);
        setBusy(null);
        return;
      }
      window.location.assign(data?.redirect && data.url ? data.url : next);
    } catch {
      setError(ko.common.networkError);
      setBusy(null);
    }
  }

  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <div className={s.hero}>
          <div className={s.pets} aria-hidden="true">
            <span className={s.petA}>
              <PetSprite species="bunny" scale={2} animate />
            </span>
            <span className={s.petB}>
              <PetSprite species="cat" scale={3} animate />
            </span>
            <span className={s.petC}>
              <PetSprite species="chick" scale={2} animate />
            </span>
          </div>
          <h1 className={s.title}>{ko.signIn.title}</h1>
          <p className={s.subtitle}>{ko.signIn.subtitle}</p>
        </div>

        <div className={s.stack}>
          {signedOut && <Notice tone="success">{ko.signIn.signedOut}</Notice>}
          {connectorFlow && <Notice tone="info">{ko.signIn.connectorNotice}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}

          <button
            type="button"
            className={s.google}
            onClick={google}
            disabled={!googleEnabled || busy !== null}
          >
            <GoogleMark />
            <span>{busy === 'google' ? ko.signIn.googleBusy : ko.signIn.google}</span>
          </button>
          {!googleEnabled && <p className={s.muted}>{ko.signIn.googleUnavailable}</p>}
          <p className={s.domain}>{ko.signIn.domainNotice(hd)}</p>
        </div>

        {devLogin && (
          <section className={s.dev} aria-labelledby="dev-login-title">
            <div className={s.devHead}>
              <h2 id="dev-login-title">{ko.signIn.devTitle}</h2>
              <span className={s.devTag}>DEV</span>
            </div>
            <p className={s.muted}>{ko.signIn.devHelp}</p>
            {devUsers.length === 0 ? (
              <p className={s.muted}>{ko.signIn.devEmpty}</p>
            ) : (
              <ul className={s.devList}>
                {devUsers.map((u) => (
                  <li key={u.email}>
                    <button
                      type="button"
                      className={s.devUser}
                      disabled={busy !== null}
                      onClick={() => devSignIn(u.email)}
                      title={u.email}
                    >
                      <span className={s.devAvatar}>
                        <AvatarSprite preset={u.avatar} scale={2} label={u.name} />
                      </span>
                      <span className={s.devText}>
                        <span className={s.devName}>
                          {u.name}
                          {u.isAdmin && <span className={s.devAdmin}>관리자</span>}
                        </span>
                        <span className={s.devMeta}>
                          {busy === u.email ? ko.signIn.devBusy : (u.deskId ?? u.email)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
