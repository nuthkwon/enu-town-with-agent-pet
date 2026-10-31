'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useDirectory } from '@/components/town/hooks';
import { SpellBar } from '@/components/town/SpellBar';
import { castState } from '@/components/town/townModel';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { useOfficeOpen, useRoster } from '@/realtime/useRealtime';
import { useDen } from './DenProvider';
import s from './den.module.css';

/**
 * `마법` in the messenger (a colleague's page and our DM): the same spellbook as the town menu. The spell plays in
 * the town for everyone, as a wave does; here the caster gets the toast and the sound.
 */
export function MagicButton({ peerId }: { peerId: string }) {
  const { me, session, directory } = useDen();
  useDirectory(directory);
  const roster = useRoster(session);
  const officeOpen = useOfficeOpen(session);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const person = directory.person(peerId);
  const state = castState(
    roster.find((p) => p.id === peerId),
    roster.find((p) => p.id === me.userId),
    officeOpen,
    person,
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (peerId === me.userId) return null;
  return (
    <div className={s.magic} ref={root}>
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        title={state.reason ?? ko.magic.dialogTitle(person?.displayName ?? '')}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">✦ </span>
        {ko.magic.button}
      </Button>
      {open && (
        <div
          id={panelId}
          className={s.magicPanel}
          role="dialog"
          aria-label={ko.magic.dialogTitle(person?.displayName ?? '')}
        >
          <SpellBar
            session={session}
            targetId={peerId}
            disabledReason={state.reason}
            onCast={() => setOpen(false)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
