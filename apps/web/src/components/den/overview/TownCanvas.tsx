'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { useDen } from '../DenProvider';
import s from '../den.module.css';

// Phaser touches `window` at import time: only ever load the game in the browser.
const PhaserGame = dynamic(() => import('@/game/PhaserGame'), { ssr: false, loading: () => null });

/**
 * The town canvas with its loading and error states. Mount it in one place at a time: while the overview popup
 * shows the town, the panel shows a placeholder instead (one Phaser game per tab).
 */
export function TownCanvas() {
  const { me, bridge, bus, mapError, retryMap } = useDen();
  const router = useRouter();
  const t = ko.den.town;

  // A click on someone in the panel opens their page (spells, DM, pets); on myself, my settings.
  useEffect(
    () =>
      bus.on('entity:clicked', ({ userId }) =>
        router.push(userId === me.userId ? '/me' : `/people/${encodeURIComponent(userId)}`),
      ),
    [bus, router, me.userId],
  );

  // Whatever surrounds the canvas sits outside it: the camera fits the whole canvas (compact below 704 px).
  useEffect(() => {
    const emit = () => bus.emit('camera:insets', { top: 0, right: 0, bottom: 0, left: 0 });
    emit();
    return bus.on('game:ready', emit);
  }, [bus]);

  return (
    <div className={s.townCanvas}>
      {bridge ? (
        <PhaserGame bridge={bridge} />
      ) : (
        <div className={s.townMessage} role="status">
          {mapError ? (
            <>
              <span>{t.error}</span>
              <Button size="sm" onClick={retryMap}>
                {ko.common.retry}
              </Button>
            </>
          ) : (
            <span>{t.loading}</span>
          )}
        </div>
      )}
    </div>
  );
}
