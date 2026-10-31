'use client';

import type { DmMsg, EmoteMsg, ErrorMsg, NoticeMsg, PingedMsg, SpellMsg } from '@enu/protocol';
import { useEffect, useRef } from 'react';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import type { ToastInput } from './TownContext';

/**
 * Realtime events -> toasts, shared by the full-screen town and the messenger, so someone who keeps only the
 * messenger open is still called, waved at and spelled (ADR 0008). Pure: what a toast says and offers is decided
 * here, the shells only show it. Spells toast only the two people involved; a spell that bounced off a shield
 * does not interrupt its target.
 */
export type NoticeEvent =
  | { kind: 'notice'; msg: NoticeMsg }
  | { kind: 'pinged'; msg: PingedMsg }
  | { kind: 'emote'; msg: EmoteMsg }
  | { kind: 'spell'; msg: SpellMsg }
  | { kind: 'error'; msg: ErrorMsg }
  | { kind: 'dm'; msg: DmMsg };

export interface NoticeCtx {
  meId: string;
  nameOf(userId: string): string;
  /** The DM thread with this person is on screen (its messages need no toast). */
  viewingDm(peerId: string): boolean;
  openDm(peerId: string): void;
  openLog(logId: string): void;
  makeLogPrivate(logId: string): Promise<void>;
}

export function noticeFor(e: NoticeEvent, ctx: NoticeCtx): ToastInput | null {
  const t = ko.townUi.toast;
  const m = ko.magic.toast;
  switch (e.kind) {
    case 'notice': {
      const logId = e.msg.logId;
      if (e.msg.kind === 'work_log_published' && logId) {
        return {
          text: t.workLogPublished,
          ttlMs: 15_000,
          actions: [
            { label: t.view, onClick: () => ctx.openLog(logId) },
            { label: t.makePrivate, onClick: () => ctx.makeLogPrivate(logId) },
          ],
        };
      }
      return e.msg.text ? { text: e.msg.text, ttlMs: 8000 } : null;
    }
    case 'pinged': {
      const from = e.msg.fromUserId;
      return {
        text: t.pinged(e.msg.fromName),
        ttlMs: 12_000,
        actions: [{ label: t.openDm, onClick: () => ctx.openDm(from) }],
      };
    }
    case 'emote':
      // Everyone sees a wave's arc on the map; only its target also gets a toast.
      if (e.msg.kind !== 'wave' || e.msg.toUserId !== ctx.meId || e.msg.fromUserId === ctx.meId) return null;
      return { text: t.waved(ctx.nameOf(e.msg.fromUserId)), ttlMs: 3500 };
    case 'spell': {
      const { fromUserId, toUserId, spell, outcome } = e.msg;
      if (fromUserId === toUserId) return null;
      const name = ko.magic.spells[spell].name;
      if (fromUserId === ctx.meId) {
        const who = ctx.nameOf(toUserId);
        if (outcome === 'blocked') return { text: m.blocked(who), ttlMs: 3500, tone: 'warn' };
        if (outcome === 'combo') return { text: m.combo(who), ttlMs: 3000, tone: 'success' };
        return { text: m.cast(who, name), ttlMs: 2500, tone: 'success' };
      }
      if (toUserId === ctx.meId) {
        const who = ctx.nameOf(fromUserId);
        if (outcome === 'blocked') return null;
        if (outcome === 'combo') return { text: m.combo(who), ttlMs: 3500, tone: 'success' };
        if (outcome === 'raid') return { text: m.raid, ttlMs: 4500, tone: 'success' };
        return { text: m.got(who, name), ttlMs: 3500 };
      }
      return null;
    }
    case 'error': {
      const { code, type } = e.msg;
      if (type === 'social:cast') {
        if (code === 'RATE_LIMITED') return { text: m.rateLimited, ttlMs: 3000, tone: 'warn' };
        if (code === 'NOT_SHOWN') return { text: m.notShown, ttlMs: 3500, tone: 'warn' };
        if (code === 'NOT_ACCEPTED') return { text: m.notAccepted, ttlMs: 3000, tone: 'warn' };
        return null;
      }
      if (
        code === 'RATE_LIMITED' &&
        (type === 'social:ping' || type === 'social:wave' || type === 'status:set')
      )
        return { text: t.rateLimited, ttlMs: 3000, tone: 'warn' };
      if (type === 'social:ping' && code === 'NOT_ONLINE')
        return { text: t.notOnline, ttlMs: 3000, tone: 'warn' };
      if (type === 'social:wave' && code === 'NOT_SHOWN')
        return { text: t.notShown, ttlMs: 3000, tone: 'warn' };
      if (type === 'status:set' && code === 'INTERNAL')
        return { text: t.statusFailed, ttlMs: 4000, tone: 'warn' };
      return null;
    }
    case 'dm': {
      const from = e.msg.fromUserId;
      if (from === ctx.meId || e.msg.toUserId !== ctx.meId || ctx.viewingDm(from)) return null;
      return {
        text: t.dmFrom(e.msg.fromName),
        ttlMs: 8000,
        actions: [{ label: t.open, onClick: () => ctx.openDm(from) }],
      };
    }
  }
}

/** Subscribes a shell to the session and shows `noticeFor` toasts. `ctx` may change between renders. */
export function useSessionNotices(
  session: RealtimeSession,
  ctx: NoticeCtx,
  toast: (t: ToastInput) => void,
): void {
  const ref = useRef(ctx);
  useEffect(() => {
    ref.current = ctx;
  });
  useEffect(() => {
    const show = (e: NoticeEvent) => {
      const t = noticeFor(e, ref.current);
      if (t) toast(t);
    };
    const offs = [
      session.on('notice', (msg) => show({ kind: 'notice', msg })),
      session.on('pinged', (msg) => show({ kind: 'pinged', msg })),
      session.on('emote', (msg) => show({ kind: 'emote', msg })),
      session.on('spell', (msg) => show({ kind: 'spell', msg })),
      session.on('server:error', (msg) => show({ kind: 'error', msg })),
      session.on('dm:msg', (msg) => show({ kind: 'dm', msg })),
    ];
    return () => offs.forEach((off) => off());
  }, [session, toast]);
}
