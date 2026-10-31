'use client';

import { useSyncExternalStore } from 'react';

/**
 * Sound settings live only in this browser (ADR 0008): nothing about them is sent to the server. On by default
 * and quiet; the speaker button and /me turn them off at once.
 */
export type SoundLevel = 'low' | 'mid' | 'high';

export interface SoundPrefs {
  on: boolean;
  level: SoundLevel;
}

export const SOUND_LEVELS: readonly SoundLevel[] = ['low', 'mid', 'high'];
export const DEFAULT_SOUND_PREFS: SoundPrefs = { on: true, level: 'low' };
export const SOUND_PREFS_KEY = 'enu-den:sound';

/** Reads a stored value; anything unexpected falls back to the default. */
export function parseSoundPrefs(raw: string | null): SoundPrefs {
  if (!raw) return DEFAULT_SOUND_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<SoundPrefs> | null;
    return {
      on: typeof v?.on === 'boolean' ? v.on : DEFAULT_SOUND_PREFS.on,
      level: SOUND_LEVELS.includes(v?.level as SoundLevel)
        ? (v!.level as SoundLevel)
        : DEFAULT_SOUND_PREFS.level,
    };
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

let current: SoundPrefs | null = null;
const listeners = new Set<() => void>();

function read(): SoundPrefs {
  try {
    return parseSoundPrefs(window.localStorage.getItem(SOUND_PREFS_KEY));
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

export function getSoundPrefs(): SoundPrefs {
  if (typeof window === 'undefined') return DEFAULT_SOUND_PREFS;
  current ??= read();
  return current;
}

export function setSoundPrefs(patch: Partial<SoundPrefs>): void {
  current = { ...getSoundPrefs(), ...patch };
  try {
    window.localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: the setting holds for this page only */
  }
  for (const fn of listeners) fn();
}

export function subscribeSoundPrefs(fn: () => void): () => void {
  listeners.add(fn);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SOUND_PREFS_KEY) return;
    current = parseSoundPrefs(e.newValue);
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(subscribeSoundPrefs, getSoundPrefs, () => DEFAULT_SOUND_PREFS);
}
