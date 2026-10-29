'use client';

import type { DeskDto, MeDto, OwnerPetDto, PersonDto, PetChannelStatusDto } from '@enu/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GameBridge } from '@/game/bridge';
import { TownDirectory } from '@/game/directory';
import { EventBus } from '@/game/EventBus';
import { loadMapBundle, type MapBundle } from '@/game/mapBundle';
import { apiFetch } from '@/lib/api';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import type { ConnectionStatus } from '@/realtime/types';
import { useRealtime } from '@/realtime/useRealtime';

/**
 * Everything the messenger shares across its pages, owned once at layout level: the one realtime session of
 * this tab (a second tab takes it over with 4101), the map and people directory of the town panel, my pets
 * and whether a paired Claude Code is listening. `pet:refetch` (owner-only, ids only) refreshes what changed.
 */
export interface DenContextValue {
  me: MeDto;
  session: RealtimeSession;
  status: ConnectionStatus;
  bus: EventBus;
  directory: TownDirectory;
  /** The town bridge once the map is loaded (null before or on error). */
  bridge: GameBridge | null;
  mapError: boolean;
  retryMap(): void;
  pets: OwnerPetDto[] | null;
  reloadPets(): void;
  channel: PetChannelStatusDto | null;
  reloadChannel(): void;
  /** Bumps for every owner-only refetch signal: rooms reload when it names them (or null = all pets). */
  petSignal: { petId: string | null; n: number };
}

const DenContext = createContext<DenContextValue | null>(null);

export function useDen(): DenContextValue {
  const v = useContext(DenContext);
  if (!v) throw new Error('useDen must be used inside <DenProvider>');
  return v;
}

export function DenProvider({ me, children }: { me: MeDto; children: ReactNode }) {
  const [bus] = useState(() => new EventBus());
  const [directory] = useState(() => new TownDirectory());
  const [map, setMap] = useState<MapBundle | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const { session, status } = useRealtime({ userId: me.userId }, map !== null);
  const [pets, setPets] = useState<OwnerPetDto[] | null>(null);
  const [channel, setChannel] = useState<PetChannelStatusDto | null>(null);
  const [petSignal, setPetSignal] = useState<{ petId: string | null; n: number }>({ petId: null, n: 0 });

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
    apiFetch<PersonDto[]>('/api/v1/people', { signal: ctrl.signal })
      .then((people) => directory.setPeople(people ?? []))
      .catch(() => undefined);
    apiFetch<DeskDto[]>('/api/v1/desks', { signal: ctrl.signal })
      .then((desks) => directory.setDesks(desks ?? []))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [directory]);

  const reloadPets = useCallback(() => {
    apiFetch<OwnerPetDto[]>('/api/v1/me/pets')
      .then(setPets)
      .catch(() => undefined);
  }, []);
  const reloadChannel = useCallback(() => {
    apiFetch<PetChannelStatusDto>('/api/v1/me/pet-channel/status')
      .then(setChannel)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    reloadPets();
    reloadChannel();
    // Whether a Claude Code is listening lives only in the web server's memory: ask again now and then.
    const timer = setInterval(reloadChannel, 30_000);
    return () => clearInterval(timer);
  }, [reloadPets, reloadChannel]);

  useEffect(
    () =>
      session.on('pet:refetch', ({ petId }) => {
        reloadPets();
        setPetSignal((s) => ({ petId, n: s.n + 1 }));
      }),
    [session, reloadPets],
  );

  const bridge = useMemo<GameBridge | null>(
    () => (map ? { me, session, bus, directory, map } : null),
    [me, session, bus, directory, map],
  );

  const value = useMemo<DenContextValue>(
    () => ({
      me,
      session,
      status,
      bus,
      directory,
      bridge,
      mapError,
      retryMap: () => {
        setMapError(false);
        setMapAttempt((n) => n + 1);
      },
      pets,
      reloadPets,
      channel,
      reloadChannel,
      petSignal,
    }),
    [
      me,
      session,
      status,
      bus,
      directory,
      bridge,
      mapError,
      pets,
      reloadPets,
      channel,
      reloadChannel,
      petSignal,
    ],
  );
  return <DenContext.Provider value={value}>{children}</DenContext.Provider>;
}
