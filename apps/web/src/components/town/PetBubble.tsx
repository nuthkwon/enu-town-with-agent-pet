'use client';

import { BubbleKind } from '@enu/protocol';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { usePet } from '@/realtime/useRealtime';
import { api, sendJson } from './api';
import { Popover } from './Chrome';
import { formatHm } from './format';
import { snoozeUntilIso } from './MyPetPanel';
import { useTown } from './TownContext';
import s from './town.module.css';

/**
 * Actions for the owner's pet bubble: 확인 / 30분 뒤에 / 닫기 (POST /api/v1/me/nudges/:id/actions).
 * For a to-do due bubble (bubbleKind TodoDue the id is the to-do): 완료 / 30분 뒤에 / 닫기.
 * The bubble text is quoted verbatim; the due time is shown separately as system info.
 */
export function PetBubbleActions({ bubbleId, x, y }: { bubbleId: string; x: number; y: number }) {
  const { session, me, ui, bus } = useTown();
  const pet = usePet(session, me.userId);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = ko.townUi.bubble;
  const live = pet && pet.bubbleId === bubbleId ? pet : null;
  const isTodo = live?.bubbleKind === BubbleKind.TodoDue;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
      session.bubbleSeen(bubbleId);
      bus.emit('pet:bubble-hide', { bubbleId });
      ui.closePopover();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const nudge = (action: 'ack' | 'dismiss' | 'snooze') =>
    run(() =>
      sendJson(
        'POST',
        api.nudgeAction(bubbleId),
        action === 'snooze' ? { action, snooze_minutes: 30 } : { action },
      ),
    );
  const todo = (body: Record<string, unknown>) => run(() => sendJson('PATCH', api.myTodo(bubbleId), body));

  return (
    <Popover x={x} y={y} onClose={ui.closePopover} label={t.title}>
      <div className={s.popoverHeader}>
        <div className={s.popoverTitle}>{t.title}</div>
      </div>
      {live?.bubbleText && <p className={s.bubbleQuote}>{live.bubbleText}</p>}
      {live && live.bubbleDueAt > 0 && (
        <span className={s.dueLine}>⏰ {t.due(formatHm(live.bubbleDueAt))}</span>
      )}
      <div className={s.cardActions}>
        {isTodo ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => todo({ status: 'done' })} data-autofocus>
              {t.done}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => todo({ snoozed_until: snoozeUntilIso(30) })}
            >
              {t.snooze30}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                session.bubbleSeen(bubbleId);
                bus.emit('pet:bubble-hide', { bubbleId });
                ui.closePopover();
              }}
            >
              {t.dismiss}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={() => nudge('ack')} data-autofocus>
              {t.ack}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => nudge('snooze')}>
              {t.snooze30}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => nudge('dismiss')}>
              {t.dismiss}
            </Button>
          </>
        )}
      </div>
      {failed && <p className={s.err}>{t.failed}</p>}
    </Popover>
  );
}

/** Screen-reader mirror of the owner's own pet bubble (exact text, polite). */
export function PetBubbleLiveRegion() {
  const { session, me } = useTown();
  const pet = usePet(session, me.userId);
  const text = pet?.bubbleText ?? '';
  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true" role="status">
      {text}
    </div>
  );
}
