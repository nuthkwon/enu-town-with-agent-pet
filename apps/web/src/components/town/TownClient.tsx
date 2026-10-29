'use client';

import type { MeDto } from '@enu/shared';
import { ko } from '@/i18n/ko';

/** Placeholder: the game client (Phaser world + React overlays) replaces this component. */
export default function TownClient({ me }: { me: MeDto }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-pixel)',
        color: 'var(--c-ink-soft)',
      }}
      data-user={me.userId}
    >
      {ko.town.loading}…
    </div>
  );
}
