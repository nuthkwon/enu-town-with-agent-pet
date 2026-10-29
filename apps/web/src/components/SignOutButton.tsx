'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ko } from '@/i18n/ko';
import { Button } from './ui';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/auth/sign-out', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
        } finally {
          router.replace('/sign-in?signed_out=1');
          router.refresh();
        }
      }}
    >
      {ko.nav.signOut}
    </Button>
  );
}
