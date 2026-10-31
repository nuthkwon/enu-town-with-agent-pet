'use client';

import { FX_CATALOG } from '@enu/fx/catalog';
import type { FxCatalogEntry } from '@enu/fx/types';
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { playMine } from '@/sound/engine';
import s from './fx.module.css';

export function fxEntry(id: string): FxCatalogEntry | null {
  return (FX_CATALOG as Record<string, FxCatalogEntry>)[id] ?? null;
}

/**
 * A baked pixelfx strip played with CSS `steps()` (no canvas in the messenger): the effect's origin is put on
 * `at` (px inside the positioned parent). One-shots end empty and call `onDone`; with reduced motion they are
 * skipped in a blink.
 */
export function FxSprite({
  id,
  at,
  scale,
  onDone,
}: {
  id: string;
  at: { x: number; y: number };
  /** Display scale (the pet room draws at the companion's 4x); default: the effect's own. */
  scale?: number;
  onDone?: () => void;
}) {
  const e = fxEntry(id);
  if (!e) return null;
  const k = scale ?? e.scale;
  const w = e.w * k;
  const h = e.h * k;
  const style = {
    left: at.x - e.pivot[0] * k,
    top: at.y - e.pivot[1] * k,
    width: w,
    height: h,
    backgroundImage: `url("${e.url}")`,
    backgroundSize: `${e.frames * w}px ${h}px`,
    '--fx-frames': e.frames,
    '--fx-dur': `${e.frames / e.fps}s`,
    '--fx-end': `${-e.frames * w}px`,
    '--fx-iter': e.loop ? 'infinite' : '1',
  } as CSSProperties;
  return (
    <span
      className={s.strip}
      style={style}
      data-fx={id}
      aria-hidden="true"
      onAnimationEnd={(ev) => {
        if (ev.target === ev.currentTarget) onDone?.();
      }}
    />
  );
}

interface Playing {
  key: number;
  id: string;
  at: { x: number; y: number };
  scale?: number;
}

/**
 * A layer of transient effects over a positioned box: `play(id, at)` adds one, it removes itself when done.
 * Effects that are still looping stay until `stop(id)`.
 */
export function useFxLayer(): {
  play: (id: string, at: { x: number; y: number }, scale?: number) => void;
  stop: (id: string) => void;
  layer: ReactNode;
} {
  const [items, setItems] = useState<Playing[]>([]);
  const seq = useRef(0);
  const play = useCallback((id: string, at: { x: number; y: number }, scale?: number) => {
    if (!fxEntry(id)) return;
    const key = ++seq.current;
    setItems((prev) => [...prev.slice(-7), { key, id, at, scale }]);
  }, []);
  const stop = useCallback((id: string) => setItems((prev) => prev.filter((p) => p.id !== id)), []);
  const layer = (
    <span className={s.layer} aria-hidden="true">
      {items.map((p) => (
        <FxSprite
          key={p.key}
          id={p.id}
          at={p.at}
          scale={p.scale}
          onDone={() => setItems((prev) => prev.filter((x) => x.key !== p.key))}
        />
      ))}
    </span>
  );
  return { play, stop, layer };
}

/**
 * 퀘스트 완료: the seal over the button I pressed and the jingle (my own screen only, ADR 0008). Put `layer` inside
 * the positioned box that gets `attach` as its ref.
 */
export function useQuestCelebration(play: (id: string, at: { x: number; y: number }) => void) {
  const [box, attach] = useState<HTMLElement | null>(null);
  const celebrate = useCallback(
    (el: HTMLElement) => {
      const b = box?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (b) play('ui/quest-done', { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 });
      playMine('quest.done');
    },
    [box, play],
  );
  return { attach, celebrate };
}
