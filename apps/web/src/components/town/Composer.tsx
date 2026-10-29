'use client';

import { LIMITS, graphemeLength } from '@enu/shared';
import { forwardRef, useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import s from './town.module.css';

/** True for Enter presses that should send (not while an IME is composing Hangul). */
export function isSendEnter(e: { key: string; shiftKey: boolean; nativeEvent: { isComposing?: boolean }; keyCode?: number }): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
  return true;
}

/**
 * Chat/DM input: Enter sends (ignored while composing), Shift+Enter adds a line, grapheme counter
 * against the 500-character limit. Text is sent exactly as typed (the server normalizes).
 */
export const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSend: (text: string) => boolean;
    placeholder: string;
    label: string;
    disabled?: boolean;
    disabledReason?: string;
    note?: string;
    rows?: number;
  }
>(function Composer({ value, onChange, onSend, placeholder, label, disabled, disabledReason, note, rows = 1 }, ref) {
  const [error, setError] = useState<string | null>(null);
  const len = graphemeLength(value);
  const over = len > LIMITS.chatMaxLen;
  const empty = value.trim() === '';

  const send = () => {
    if (disabled || over || empty) return;
    if (onSend(value)) {
      onChange('');
      setError(null);
    } else {
      setError(ko.townUi.dm.failed);
    }
  };

  return (
    <form
      className={s.composer}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {note && <div className={s.draftNote}>{note}</div>}
      <div className={s.composerRow}>
        <textarea
          ref={ref}
          className={s.composerInput}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (isSendEnter(e)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="submit" size="sm" disabled={disabled || over || empty}>
          {ko.townUi.chat.send}
        </Button>
      </div>
      <div className={s.composerMeta}>
        <span role={error || (disabled && disabledReason) ? 'status' : undefined}>
          {error ?? (disabled ? (disabledReason ?? '') : '')}
        </span>
        <span className={over ? s.overLimit : undefined} aria-live={over ? 'polite' : undefined}>
          {len}/{LIMITS.chatMaxLen}
        </span>
      </div>
    </form>
  );
});
