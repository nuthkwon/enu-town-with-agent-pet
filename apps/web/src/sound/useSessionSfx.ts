'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import { soundEngine } from './engine';
import { decideSfx, type SfxEvent } from './policy';
import { subscribeSoundPrefs } from './prefs';

/**
 * Turns this tab's realtime events into sounds through the gate table (`decideSfx`). Mounted once by each shell
 * (the messenger and the full-screen town). Rejected social actions answer with a soft "nope".
 */
export function useSessionSfx(session: RealtimeSession, meId: string): void {
  useEffect(() => {
    const engine = soundEngine();
    const uninstall = engine.install();
    const play = (e: SfxEvent) => {
      const id = decideSfx(e, meId);
      if (id) engine.play(id);
    };
    const offs = [
      session.on('spell', (msg) => play({ kind: 'spell', msg })),
      session.on('emote', (m) => {
        if (m.kind === 'wave') play({ kind: 'wave', fromUserId: m.fromUserId, toUserId: m.toUserId });
      }),
      session.on('pinged', () => play({ kind: 'ping-in' })),
      session.on('dm:msg', (m) => {
        if (m.fromUserId === meId || m.toUserId !== meId) return;
        play({ kind: 'dm-in', viewing: session.getActiveDmPeer() === m.fromUserId });
      }),
      session.on('notice', (m) => {
        if (m.kind === 'work_log_published') play({ kind: 'log-notice' });
      }),
      session.on('server:error', (e) => {
        if (e.type === 'social:cast' || e.type === 'social:wave' || e.type === 'social:ping')
          play({ kind: 'mine', id: 'ui.nope' });
      }),
    ];
    return () => {
      for (const off of offs) off();
      uninstall();
    };
  }, [session, meId]);
}

/** The engine's state for the speaker button: 'locked' (no gesture yet), 'on' or 'off'. */
export function useSoundState(): 'locked' | 'on' | 'off' {
  return useSyncExternalStore(
    (fn) => {
      const offEngine = soundEngine().subscribe(fn);
      const offPrefs = subscribeSoundPrefs(fn);
      return () => {
        offEngine();
        offPrefs();
      };
    },
    () => soundEngine().state,
    () => 'locked',
  );
}
