'use client';

import { SFX_IDS, renderSfx, type SfxId } from '@enu/sfx';
import { BACKGROUND_GAP_MS } from './policy';
import { getSoundPrefs, subscribeSoundPrefs, type SoundLevel, type SoundPrefs } from './prefs';

/** Master gain per level (the recipes are already loudness-normalised per category). */
export const LEVEL_GAIN: Record<SoundLevel, number> = { low: 0.35, mid: 0.6, high: 1 };
/** At most this many sounds at once (the oldest stops). */
export const MAX_VOICES = 4;
/** The same sound again within this many ms is dropped (a burst of events is one sound). */
export const SAME_ID_GAP_MS = 90;

type DropReason = 'off' | 'locked' | 'background' | 'repeat';

interface DebugLog {
  played: { id: SfxId; at: number }[];
  dropped: { id: SfxId; at: number; reason: DropReason }[];
}

type AudioContextCtor = new () => AudioContext;

/**
 * The one place that makes sound (ESLint keeps the Web Audio API in `src/sound`). The AudioContext is created
 * on the first pointer or key press (browsers require a gesture); sounds before that are dropped, never queued.
 * Buffers are rendered from the @enu/sfx recipes at the context's sample rate, once, and warmed while idle.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SfxId, AudioBuffer>();
  private voices: { src: AudioBufferSourceNode; id: SfxId }[] = [];
  private readonly lastAt = new Map<SfxId, number>();
  private readonly lastBackgroundAt = new Map<SfxId, number>();
  private installed = 0;
  private uninstall: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  /** Dev/e2e only: what played and what was dropped (never in production builds). */
  readonly debug: DebugLog | null =
    process.env.NODE_ENV === 'production' ? null : { played: [], dropped: [] };

  constructor(
    private readonly env: {
      now: () => number;
      hidden: () => boolean;
      audioContext: () => AudioContextCtor | null;
    } = {
      now: () => performance.now(),
      hidden: () => document.visibilityState !== 'visible',
      audioContext: () =>
        (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
          null) as AudioContextCtor | null,
    },
  ) {}

  /** 'locked' until the first gesture, then whether the user wants sound. */
  get state(): 'locked' | 'on' | 'off' {
    if (!getSoundPrefs().on) return 'off';
    return this.ctx && this.ctx.state === 'running' ? 'on' : 'locked';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Listens for the first gesture and for setting changes. Reference-counted (both shells may mount). */
  install(): () => void {
    this.installed++;
    if (this.installed === 1) {
      const onGesture = () => this.unlock();
      window.addEventListener('pointerdown', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
      const offPrefs = subscribeSoundPrefs(() => this.applyPrefs(getSoundPrefs()));
      this.uninstall = () => {
        window.removeEventListener('pointerdown', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
        offPrefs();
      };
    }
    return () => {
      this.installed--;
      if (this.installed === 0) {
        this.uninstall?.();
        this.uninstall = null;
      }
    };
  }

  /** Creates or resumes the AudioContext; call only from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = this.env.audioContext();
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyPrefs(getSoundPrefs());
      this.ctx.addEventListener('statechange', () => this.changed());
      this.warm();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.changed());
    this.changed();
  }

  private applyPrefs(p: SoundPrefs): void {
    if (this.master && this.ctx)
      this.master.gain.setValueAtTime(p.on ? LEVEL_GAIN[p.level] : 0, this.ctx.currentTime);
    if (!p.on) this.stopAll();
    this.changed();
  }

  stopAll(): void {
    for (const v of this.voices.splice(0)) {
      try {
        v.src.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  /** Renders every buffer ahead of time, one per idle slot, so a first spell does not hitch the town. */
  private warm(): void {
    const ids = SFX_IDS.filter((id) => !this.buffers.has(id));
    const step = () => {
      const id = ids.shift();
      if (!id) return;
      this.buffer(id);
      schedule();
    };
    const schedule = () => {
      const w = window as unknown as { requestIdleCallback?: (fn: () => void) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(step);
      else setTimeout(step, 30);
    };
    schedule();
  }

  private buffer(id: SfxId): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let b = this.buffers.get(id);
    if (!b) {
      const data = renderSfx(id, ctx.sampleRate);
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(id, b);
    }
    return b;
  }

  private drop(id: SfxId, reason: DropReason): false {
    this.debug?.dropped.push({ id, at: this.env.now(), reason });
    return false;
  }

  /** Plays one sound if the settings, the tab and the gesture allow it. Returns whether it started. */
  play(id: SfxId): boolean {
    if (!getSoundPrefs().on) return this.drop(id, 'off');
    const now = this.env.now();
    if (this.env.hidden()) {
      const gap = BACKGROUND_GAP_MS[id];
      if (gap === undefined || now - (this.lastBackgroundAt.get(id) ?? -Infinity) < gap)
        return this.drop(id, 'background');
      this.lastBackgroundAt.set(id, now);
    }
    if (now - (this.lastAt.get(id) ?? -Infinity) < SAME_ID_GAP_MS) return this.drop(id, 'repeat');
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return this.drop(id, 'locked');
    const buf = this.buffer(id);
    if (!buf) return this.drop(id, 'locked');
    this.lastAt.set(id, now);
    while (this.voices.length >= MAX_VOICES) {
      const old = this.voices.shift();
      try {
        old?.src.stop();
      } catch {
        /* already stopped */
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    const voice = { src, id };
    this.voices.push(voice);
    src.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      src.disconnect();
    };
    src.start();
    if (this.debug) {
      this.debug.played.push({ id, at: now });
      // The demo recorder mixes the same recipes into the video's audio at the times it hears about here.
      (window as unknown as { __enuSfxTap?: (id: string) => void }).__enuSfxTap?.(id);
    }
    return true;
  }
}

let engine: SoundEngine | null = null;

/** The page's engine (created on first use in the browser). */
export function soundEngine(): SoundEngine {
  engine ??= new SoundEngine();
  if (engine.debug && typeof window !== 'undefined') {
    const debug = engine.debug;
    (window as unknown as { __ENU_DEN_SFX__?: unknown }).__ENU_DEN_SFX__ = {
      played: () => debug.played.map((p) => p.id),
      dropped: () => debug.dropped.map((d) => `${d.id}:${d.reason}`),
      clear: () => {
        debug.played.length = 0;
        debug.dropped.length = 0;
      },
      state: () => engine?.state,
    };
  }
  return engine;
}

/** Plays a sound I caused myself (clicks, my familiar, my quest). */
export function playMine(id: SfxId): void {
  if (typeof window !== 'undefined') soundEngine().play(id);
}
