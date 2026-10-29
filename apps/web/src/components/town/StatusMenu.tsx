'use client';

import { STATUS_LABEL_KO, Status } from '@enu/protocol';
import { LIMITS } from '@enu/shared';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { useConnectionStatus, usePet } from '@/realtime/useRealtime';
import { Popover } from './Chrome';
import { useTown } from './TownContext';
import s from './town.module.css';

const ORDER: Status[] = [Status.Available, Status.Focus, Status.Meeting, Status.Away];

/** 대화 가능 / 집중 모드 / 회의 중 / 자리 비움 + optional status text (sent as status:set). */
export function StatusMenu({ x, y }: { x: number; y: number }) {
  const { session, me, ui } = useTown();
  usePet(session, me.userId); // re-render on roster changes
  const conn = useConnectionStatus(session);
  const mine = session.getPlayer(me.userId);
  const [status, setStatus] = useState<number>(mine?.status ?? Status.Available);
  const [text, setText] = useState<string>(mine?.statusText ?? me.statusText ?? '');
  const t = ko.townUi.status;
  const connected = conn.kind === 'connected';

  const apply = (nextText: string) => {
    if (session.setStatusMode(status, nextText.trim())) ui.closePopover();
  };

  return (
    <Popover x={x} y={y} onClose={ui.closePopover} label={t.title} anchor="below">
      <div className={s.popoverHeader}>
        <div className={s.popoverTitle}>{t.title}</div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(text);
        }}
      >
        <fieldset className={s.radioList}>
          <legend className="visually-hidden">{t.title}</legend>
          {ORDER.map((st) => (
            <label key={st} className={s.radio}>
              <input
                type="radio"
                name="town-status"
                value={st}
                checked={status === st}
                onChange={() => setStatus(st)}
                data-autofocus={status === st ? true : undefined}
              />
              <span className={`${s.statusDot} ${s[`status-${st}`]}`} aria-hidden="true" />
              {STATUS_LABEL_KO[st]}
            </label>
          ))}
        </fieldset>
        <label className={s.label} htmlFor="town-status-text">
          {t.textLabel}
        </label>
        <input
          id="town-status-text"
          className={s.textInput}
          value={text}
          maxLength={LIMITS.statusTextMax}
          placeholder={t.placeholder}
          onChange={(e) => setText(e.target.value)}
        />
        <div className={s.actionRow}>
          <Button type="submit" size="sm" disabled={!connected}>
            {t.apply}
          </Button>
          {text && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!connected}
              onClick={() => {
                setText('');
                apply('');
              }}
            >
              {t.clear}
            </Button>
          )}
        </div>
        {!connected && <p className={s.err}>{t.notConnected}</p>}
      </form>
    </Popover>
  );
}
