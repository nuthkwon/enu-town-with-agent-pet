'use client';

import { PlateNote } from '@enu/protocol';
import { teamLabel } from '@enu/shared';
import { teamColor } from '@/game/directory';
import { activityIcon, displayForm } from '@/game/logic/presence';
import { ko } from '@/i18n/ko';
import { useOfficeOpen, useRoster } from '@/realtime/useRealtime';
import { EffectIcon } from './EffectIcon';
import { useDirectory } from './hooks';
import { useTown } from './TownContext';
import s from './town.module.css';

const CARD_W = 260;

/** Below-right of the pointer, flipped to the left near the right edge (the docked rail lives there). */
function placement(x: number, y: number): { left: number; top: number } {
  const vw = typeof window === 'undefined' ? Infinity : window.innerWidth;
  const left = x + 14 + CARD_W > vw - 8 ? Math.max(8, x - 14 - CARD_W) : x + 14;
  return { left, top: y + 16 };
}

/**
 * Hover tooltip for an avatar or a desk plate (spec §5.3): `이름 · 팀` / the display form / 상태 문구 /
 * `● 접속 중` (only while connected). Pointer-only sugar: the team rail shows the same as text.
 */
export function HoverCard({ userId, x, y }: { userId: string; x: number; y: number }) {
  const { session, directory, me } = useTown();
  useDirectory(directory);
  const roster = useRoster(session);
  const officeOpen = useOfficeOpen(session);
  const player = roster.find((p) => p.id === userId);
  const person = directory.person(userId);
  const name = player?.name || person?.displayName || '';
  if (!name) return null;
  const form = player && officeOpen !== false ? displayForm(player, me.officeTimeZone) : '';
  const icon = player && player.note === PlateNote.None ? activityIcon(player.activity) : null;
  const team = teamLabel(person?.team);
  return (
    <div className={s.hoverCard} style={placement(x, y)} role="tooltip">
      <div className={s.hoverName}>
        <span className={s.teamSwatch} style={{ background: teamColor(person?.team) }} aria-hidden="true" />
        {team ? `${name} · ${team}` : name}
      </div>
      {form && (
        <div className={s.hoverLine}>
          {icon && <EffectIcon name={icon} />}
          <span>{form}</span>
        </div>
      )}
      {player?.statusText && <div className={s.hoverText}>{player.statusText}</div>}
      {player?.online && <div className={s.hoverOnline}>{ko.townUi.hover.online}</div>}
    </div>
  );
}
