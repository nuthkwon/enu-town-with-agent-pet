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

type FxDepth = FxCatalogEntry['depth'];

interface Playing {
  key: number;
  id: string;
  depth: FxDepth;
  at: { x: number; y: number };
  scale?: number;
}

/** What each layer draws. */
const ALL_DEPTHS: readonly FxDepth[] = ['under', 'over'];
const UNDER: readonly FxDepth[] = ['under'];
const OVER: readonly FxDepth[] = ['over'];

/**
 * Transient effects in a positioned box: `play(id, at)` adds one, it removes itself when done; effects that are
 * still looping stay until `stop(id)`. Put `layer` (every effect, over the box's content) in the box, or split them
 * by the catalog's depth: `under` before what they surround and `over` after it. `under` (floor rings, summoning
 * circles) paints below the box's content and above its background, so that box must be a stacking context
 * (`isolation: isolate`). An effect plays only while a layer that draws it is mounted: one asked for without such a
 * layer is dropped, and the last layer of a depth to go takes its effects along (nothing replays when one comes back).
 */
export function useFxLayer(): {
  play: (id: string, at: { x: number; y: number }, scale?: number) => void;
  stop: (id: string) => void;
  /** An effect is on (a box can stay up until its effect has played). */
  playing: boolean;
  layer: ReactNode;
  under: ReactNode;
  over: ReactNode;
} {
  const [items, setItems] = useState<Playing[]>([]);
  const seq = useRef(0);
  /** How many mounted layers draw each depth. */
  const drawn = useRef<Record<FxDepth, number>>({ under: 0, over: 0 });
  const play = useCallback((id: string, at: { x: number; y: number }, scale?: number) => {
    const e = fxEntry(id);
    if (!e || drawn.current[e.depth] === 0) return;
    const key = ++seq.current;
    setItems((prev) => [...prev.slice(-7), { key, id, depth: e.depth, at, scale }]);
  }, []);
  const stop = useCallback((id: string) => setItems((prev) => prev.filter((p) => p.id !== id)), []);
  // Stable ref callbacks (a new one would detach and attach its layer on every render).
  const track = useCallback((depths: readonly FxDepth[], el: HTMLSpanElement | null) => {
    if (!el) return undefined;
    for (const d of depths) drawn.current[d] += 1;
    return () => {
      for (const d of depths) drawn.current[d] -= 1;
      const gone = depths.filter((d) => drawn.current[d] === 0);
      if (gone.length > 0) setItems((prev) => prev.filter((p) => !gone.includes(p.depth)));
    };
  }, []);
  const layerRef = useCallback((el: HTMLSpanElement | null) => track(ALL_DEPTHS, el), [track]);
  const underRef = useCallback((el: HTMLSpanElement | null) => track(UNDER, el), [track]);
  const overRef = useCallback((el: HTMLSpanElement | null) => track(OVER, el), [track]);
  const strip = (p: Playing) => (
    <FxSprite
      key={p.key}
      id={p.id}
      at={p.at}
      scale={p.scale}
      onDone={() => setItems((prev) => prev.filter((x) => x.key !== p.key))}
    />
  );
  const under = items.filter((p) => p.depth === 'under').map(strip);
  const over = items.filter((p) => p.depth === 'over').map(strip);
  return {
    play,
    stop,
    playing: items.length > 0,
    layer: (
      <span ref={layerRef} className={s.layer} aria-hidden="true">
        {under}
        {over}
      </span>
    ),
    under: (
      <span ref={underRef} className={`${s.layer} ${s.under}`} aria-hidden="true">
        {under}
      </span>
    ),
    over: (
      <span ref={overRef} className={s.layer} aria-hidden="true">
        {over}
      </span>
    ),
  };
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
