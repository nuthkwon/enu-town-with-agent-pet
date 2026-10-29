'use client';

import type { DmUnreadMsg } from '@enu/protocol';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { RealtimeSession, type RealtimeSessionOptions } from './RealtimeSession';
import type { ConnectionStatus, PetSnap, PlayerSnap } from './types';

/**
 * Owns one RealtimeSession for the component's lifetime: created once (no side effects), started
 * in an effect and stopped on unmount. StrictMode's mount/unmount/mount is safe because the
 * session drops stale async work by generation. Also reports tab visibility as presence.
 * `enabled` lets the caller wait for prerequisites (e.g. the map hash) before connecting.
 */
export function useRealtime(
  options: RealtimeSessionOptions,
  enabled = true,
): { session: RealtimeSession; status: ConnectionStatus } {
  const [session] = useState(() => new RealtimeSession(options));

  useEffect(() => {
    if (!enabled) return;
    session.start();
    return () => session.stop();
  }, [session, enabled]);

  useEffect(() => {
    const onVisibility = () => session.setPresence({ visible: document.visibilityState === 'visible' });
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session]);

  const status = useConnectionStatus(session);
  return { session, status };
}

export function useConnectionStatus(session: RealtimeSession): ConnectionStatus {
  const subscribe = useCallback((cb: () => void) => session.on('status', cb), [session]);
  const get = useCallback(() => session.getStatus(), [session]);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * Every roster member (all 14 are always in the state): re-renders when someone's name, shown/online
 * state, activity or plate changes, not on moves. Use `shown`/`online`/`note`, never "is in the list".
 */
export function useRoster(session: RealtimeSession): PlayerSnap[] {
  const subscribe = useCallback((cb: () => void) => session.on('roster', cb), [session]);
  const get = useCallback(() => session.getRoster(), [session]);
  return useSyncExternalStore(subscribe, get, get);
}

/** A pet snapshot (owner-only bubble fields are filled only for the viewer's own pet). */
export function usePet(session: RealtimeSession, ownerId: string): PetSnap | undefined {
  const subscribe = useCallback((cb: () => void) => session.on('roster', cb), [session]);
  const get = useCallback(() => session.getPet(ownerId), [session, ownerId]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useDmUnread(session: RealtimeSession): DmUnreadMsg {
  const subscribe = useCallback((cb: () => void) => session.on('dm:unread', cb), [session]);
  const get = useCallback(() => session.getDmUnread(), [session]);
  return useSyncExternalStore(subscribe, get, get);
}

/** `OfficeState.officeOpen`: null until the first state arrives. */
export function useOfficeOpen(session: RealtimeSession): boolean | null {
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = [session.on('office', cb), session.on('reset', cb)];
      return () => offs.forEach((off) => off());
    },
    [session],
  );
  const get = useCallback(() => session.getOfficeOpen(), [session]);
  return useSyncExternalStore(subscribe, get, get);
}
