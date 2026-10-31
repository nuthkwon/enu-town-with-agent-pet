'use client';

import { SPELLS, type Spell } from '@enu/shared';
import { useEffect, useState, type CSSProperties } from 'react';
import type { EffectName } from '@/game/spriteSpec';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import { EffectIcon } from './EffectIcon';
import s from './town.module.css';

/** The spellbook icons (effects sheet row 4). */
const SPELL_ICON: Record<Spell, EffectName> = {
  fireball: 'fireball',
  coffee: 'coffee',
  zap: 'bolt',
  potion: 'potion',
  highfive: 'palm',
  fireworks: 'firework',
};

/** The server lets one caster hit the same person once per this many ms; the bar shows it as a cooldown ring. */
export const TARGET_COOLDOWN_MS = 15_000;
const lastCastAt = new Map<string, number>();

export function cooldownLeft(targetId: string, now: number): number {
  const at = lastCastAt.get(targetId);
  return at === undefined ? 0 : Math.max(0, at + TARGET_COOLDOWN_MS - now);
}

/**
 * The spellbook: six spells as icon buttons with a cooldown ring (the town menu and the messenger use the same
 * bar). Casting sends `social:cast`; the show, the toast and the sound come back with the server's `spell`.
 */
export function SpellBar({
  session,
  targetId,
  disabledReason,
  onCast,
  autoFocus = false,
  asMenuItems = false,
}: {
  session: RealtimeSession;
  targetId: string;
  /** Why spells cannot be cast now (shown under the bar), or null. */
  disabledReason: string | null;
  onCast?: (spell: Spell) => void;
  autoFocus?: boolean;
  /** Inside a role=menu (the town's avatar menu): the spells are its menu items. */
  asMenuItems?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const left = cooldownLeft(targetId, now);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left + 20);
    return () => clearTimeout(timer);
  }, [left]);
  const disabled = disabledReason !== null || left > 0;
  const ring: CSSProperties | undefined =
    left > 0
      ? ({
          '--cool-ms': `${TARGET_COOLDOWN_MS}ms`,
          '--cool-delay': `-${TARGET_COOLDOWN_MS - left}ms`,
        } as CSSProperties)
      : undefined;
  return (
    <div className={s.spellBar}>
      <div className={s.spellGrid} role={asMenuItems ? undefined : 'group'} aria-label={ko.magic.menuTitle}>
        {SPELLS.map((spell, i) => {
          const words = ko.magic.spells[spell];
          return (
            <button
              key={spell}
              type="button"
              role={asMenuItems ? 'menuitem' : undefined}
              className={`${s.spellButton} ${left > 0 ? s.spellCooling : ''}`}
              style={ring}
              disabled={disabled}
              data-spell={spell}
              title={`${words.name} · ${words.hint}`}
              autoFocus={autoFocus && i === 0}
              onClick={() => {
                if (!session.cast(targetId, spell)) return;
                const at = Date.now();
                lastCastAt.set(targetId, at);
                setNow(at);
                onCast?.(spell);
              }}
            >
              <EffectIcon name={SPELL_ICON[spell]} size={24} />
              <span className={s.spellName}>{words.name}</span>
            </button>
          );
        })}
      </div>
      {disabledReason ? (
        <p className={s.spellNote}>{disabledReason}</p>
      ) : left > 0 ? (
        <p className={s.spellNote}>{ko.magic.cooling}</p>
      ) : (
        <p className={s.spellNote}>{ko.magic.menuNote}</p>
      )}
    </div>
  );
}
