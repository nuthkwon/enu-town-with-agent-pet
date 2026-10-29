'use client';

import { useEffect, useRef } from 'react';
import { ko } from '@/i18n/ko';
import type { GameBridge } from './bridge';

/**
 * Mounts the Phaser game into a div that fills its parent. Phaser is imported inside the effect
 * (never during SSR); the game is destroyed on unmount. StrictMode's double mount is safe: a
 * cancelled first mount never creates a game, and a created one is always destroyed.
 */
export default function PhaserGame({ bridge, className }: { bridge: GameBridge; className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: { destroy(removeCanvas: boolean, noReturn?: boolean): void } | null = null;
    void import('./createGame').then(({ createGame }) => {
      if (cancelled) return;
      game = createGame(host, bridge);
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
      game = null;
    };
  }, [bridge]);

  return (
    <div
      ref={hostRef}
      className={className}
      role="application"
      aria-label={ko.townUi.canvasLabel}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none' }}
    />
  );
}
