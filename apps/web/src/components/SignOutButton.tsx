'use client';

import { useState } from 'react';
import { createAuthClient } from '@enu/auth/client';
import { ko } from '@/i18n/ko';
import { Button } from './ui';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await createAuthClient().signOut();
        } finally {
          window.location.assign('/sign-in?signed_out=1');
        }
      }}
    >
      {ko.nav.signOut}
    </Button>
  );
}
