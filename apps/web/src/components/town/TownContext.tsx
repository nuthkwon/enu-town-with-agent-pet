'use client';

import type { MeDto } from '@enu/shared';
import { createContext, useContext } from 'react';
import type { TownDirectory } from '@/game/directory';
import type { EventBus } from '@/game/EventBus';
import type { RealtimeSession } from '@/realtime/RealtimeSession';

export type PastChatsTab = 'dm' | 'nearby' | 'room' | 'summaries';

/** Right-hand side sheet (one at a time). */
export type Sheet =
  | { kind: 'profile'; userId: string }
  | { kind: 'worklog'; userId: string }
  | { kind: 'pastChats'; userId: string; tab: PastChatsTab }
  | { kind: 'people' }
  | { kind: 'myPet' }
  | { kind: 'dm'; peerId: string | null; draft: string | null; draftNonce: number };

/** Small anchored popovers (one at a time). */
export type Popover =
  | { kind: 'menu'; userId: string; x: number; y: number }
  | { kind: 'status'; x: number; y: number }
  | { kind: 'workRequest'; userId: string; x: number; y: number }
  | { kind: 'bubble'; bubbleId: string; x: number; y: number };

export type ToastInput = {
  text: string;
  actions?: { label: string; onClick: () => void | Promise<void> }[];
  /** Auto-dismiss after ms (default 7000; 0 = sticky). */
  ttlMs?: number;
  tone?: 'info' | 'success' | 'warn';
};

export interface TownUi {
  openMenu(userId: string, x: number, y: number): void;
  openProfile(userId: string): void;
  openWorkLog(userId: string): void;
  openPastChats(userId: string, tab?: PastChatsTab): void;
  openWorkRequest(userId: string, x: number, y: number): void;
  openDm(peerId: string | null, draft?: string | null): void;
  openPeople(): void;
  openMyPet(): void;
  openStatus(x?: number, y?: number): void;
  openBubble(bubbleId: string, x: number, y: number): void;
  closeSheet(): void;
  closePopover(): void;
  toast(t: ToastInput): void;
}

export interface TownContextValue {
  me: MeDto;
  session: RealtimeSession;
  bus: EventBus;
  directory: TownDirectory;
  ui: TownUi;
}

export const TownContext = createContext<TownContextValue | null>(null);

export function useTown(): TownContextValue {
  const v = useContext(TownContext);
  if (!v) throw new Error('useTown must be used inside <TownContext.Provider>');
  return v;
}
