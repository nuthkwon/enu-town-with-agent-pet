'use client';

import type { DeskDto, MeDto, PersonDto } from '@enu/shared';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import type { GameBridge } from '@/game/bridge';
import { TownDirectory } from '@/game/directory';
import { EventBus } from '@/game/EventBus';
import { loadMapBundle, type MapBundle } from '@/game/mapBundle';
import { ko } from '@/i18n/ko';
import { useRealtime } from '@/realtime/useRealtime';
import { api, getJson } from './api';
import { TownShell } from './TownShell';
import s from './town.module.css';

// Phaser touches `window` at import time: only ever load the game in the browser.
const PhaserGame = dynamic(() => import('@/game/PhaserGame'), { ssr: false, loading: () => null });

/**
 * The town: Phaser world (canvas) + React overlays + one realtime session.
 * Order: fetch & hash the map -> connect (join sends the hash) and start Phaser in parallel.
 */
export default function TownClient({ me }: { me: MeDto }) {
  const [bus] = useState(() => new EventBus());
  const [directory] = useState(() => new TownDirectory());
  const [map, setMap] = useState<MapBundle | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const { session, status } = useRealtime({ userId: me.userId }, map !== null);

  useEffect(() => {
    const ctrl = new AbortController();
    loadMapBundle(ctrl.signal)
      .then((bundle) => {
        session.setMapHash(bundle.hash);
        setMap(bundle);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setMapError(true);
      });
    return () => ctrl.abort();
  }, [session, mapAttempt]);

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<PersonDto[]>(api.people(), ctrl.signal)
      .then((people) => directory.setPeople(people ?? []))
      .catch(() => undefined);
    getJson<DeskDto[]>(api.desks(), ctrl.signal)
      .then((desks) => directory.setDesks(desks ?? []))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [directory]);

  // People's names/teams/desks change rarely; refresh the directory (debounced) when someone new shows up,
  // someone leaves the roster, or a Player's desk or name changes (desks_changed, profile edits).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        getJson<PersonDto[]>(api.people())
          .then((people) => directory.setPeople(people ?? []))
          .catch(() => undefined);
        getJson<DeskDto[]>(api.desks())
          .then((desks) => directory.setDesks(desks ?? []))
          .catch(() => undefined);
      }, 1500);
    };
    const offs = [
      session.on('player:add', (p) => {
        if (!directory.person(p.id)) refetch();
      }),
      session.on('player:remove', () => refetch()),
      session.on('player:change', ({ player, prev }) => {
        if (player.deskId !== prev.deskId || player.name !== prev.name) refetch();
      }),
    ];
    return () => {
      for (const off of offs) off();
      if (timer) clearTimeout(timer);
    };
  }, [session, directory]);

  const bridge: GameBridge | null = useMemo(
    () => (map ? { me, session, bus, directory, map } : null),
    [me, session, bus, directory, map],
  );

  return (
    <div className={s.root}>
      <div className={s.stage}>
        {bridge ? (
          <PhaserGame bridge={bridge} />
        ) : (
          <div className={s.centerMessage} role="status">
            {mapError ? (
              <>
                <span>{ko.townUi.mapError}</span>
                <Button
                  size="sm"
                  onClick={() => {
                    setMapError(false);
                    setMapAttempt((n) => n + 1);
                  }}
                >
                  {ko.common.retry}
                </Button>
              </>
            ) : (
              <span>{ko.townUi.loadingMap}</span>
            )}
          </div>
        )}
      </div>
      <TownShell me={me} session={session} bus={bus} directory={directory} status={status} />
    </div>
  );
}
