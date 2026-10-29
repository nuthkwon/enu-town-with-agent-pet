'use client';

import type { DeskDto } from '@enu/shared';
import { ko } from '@/i18n/ko';
import { cx } from './ui';
import s from './seat-map.module.css';

/**
 * A schematic of A동 606호 (balcony at the top, entrance at the bottom, aisle in the middle)
 * for choosing a seat. Taken seats show their occupant and cannot be picked.
 */
const LEFT_ROWS: [string, string][] = [
  ['L1a', 'L1b'],
  ['L2a', 'L2b'],
  ['L3a', 'L3b'],
  ['L4a', 'L4b'],
  ['L5a', 'L5b'],
];

export function SeatMap({
  desks,
  myUserId,
  selected,
  onSelect,
}: {
  desks: DeskDto[];
  myUserId: string;
  selected: string | null;
  onSelect: (deskId: string) => void;
}) {
  const byId = new Map(desks.map((d) => [d.deskId, d]));
  const w = ko.welcome.desk;

  const seat = (id: string, extra?: string) => {
    const d = byId.get(id);
    const mine = d?.userId === myUserId;
    const taken = Boolean(d?.userId) && !mine;
    const isSelected = selected === id;
    const label = taken
      ? (d?.displayName ?? w.taken)
      : mine
        ? w.mine
        : d?.displayName
          ? w.reserved(d.displayName)
          : w.free;
    return (
      <button
        key={id}
        type="button"
        className={cx(s.seat, extra, taken && s.taken, isSelected && s.selected, mine && s.mine)}
        disabled={taken || !d}
        aria-pressed={isSelected}
        onClick={() => onSelect(id)}
        title={label}
      >
        <span className={s.seatId}>{id}</span>
        <span className={s.seatName}>{label}</span>
      </button>
    );
  };

  return (
    <div className={s.map}>
      <div className={cx(s.zone, s.balcony)}>{w.balcony}</div>
      <div className={s.floor}>
        <div className={s.left}>
          {LEFT_ROWS.map(([a, b]) => (
            <div key={a} className={s.pair}>
              {seat(a)}
              {seat(b)}
            </div>
          ))}
          <div className={cx(s.zone, s.meeting)}>{w.meeting}</div>
        </div>
        <div className={s.aisle} aria-hidden="true">
          <span>{w.aisle}</span>
        </div>
        <div className={s.right}>
          <div className={s.pair}>{seat('R1', s.ceo)}</div>
          <div className={s.pair}>
            {seat('R2a')}
            {seat('R2b')}
          </div>
          <div className={s.pair}>
            <div className={s.storage} aria-hidden="true" />
            {seat('R3b')}
          </div>
          <div className={cx(s.zone, s.pantry)}>{w.pantry}</div>
          <div className={cx(s.zone, s.server)}>{w.server}</div>
        </div>
      </div>
      <div className={cx(s.zone, s.entrance)}>{w.entrance}</div>
      <div className={s.legend}>
        <span className={cx(s.chip, s.chipMine)}>{w.mine}</span>
        <span className={cx(s.chip, s.chipFree)}>{w.free}</span>
        <span className={cx(s.chip, s.chipTaken)}>{w.taken}</span>
      </div>
    </div>
  );
}
