'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import { AvatarSprite } from '@/components/sprites';
import { teamColor } from '@/game/directory';
import { ko } from '@/i18n/ko';
import type { PlayerSnap } from '@/realtime/types';
import { useRoster } from '@/realtime/useRealtime';
import { Sheet } from './Chrome';
import { EffectIcon } from './EffectIcon';
import { useDirectory } from './hooks';
import { useTown } from './TownContext';
import { onlineCount, railGroups, type RailRow } from './townModel';
import s from './town.module.css';

function Row({ row, onOpen }: { row: RailRow; onOpen: (row: RailRow, e: MouseEvent<HTMLButtonElement>) => void }) {
  const { bus } = useTown();
  const t = ko.townUi.people;
  const p = row.person;
  const pulse = (on: boolean) => bus.emit('person:pulse', { userId: on ? p.userId : null });
  return (
    <li>
      <button
        type="button"
        className={`${s.person} ${row.shown ? '' : s.notShownPerson}`}
        aria-haspopup="menu"
        onClick={(e) => onOpen(row, e)}
        onMouseEnter={() => pulse(true)}
        onMouseLeave={() => pulse(false)}
        onFocus={() => pulse(true)}
        onBlur={() => pulse(false)}
      >
        <span className={s.miniAvatar} style={{ width: 32, height: 32 }}>
          <AvatarSprite preset={p.avatar} scale={1} label={p.displayName} />
        </span>
        <span className={s.personMain}>
          <span className={s.personName}>
            {p.displayName}
            {row.isMe ? ` (${t.me})` : ''}
            {row.online && (
              <span className={s.onlineDot} role="img" aria-label={t.online} title={t.online} />
            )}
          </span>
          {row.form && (
            <span className={s.personState}>
              {row.icon ? <EffectIcon name={row.icon} size={16} /> : <span className={s.stateDot} aria-hidden="true" />}
              <span>{row.form}</span>
            </span>
          )}
          {row.statusText && <span className={s.personSub}>{row.statusText}</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * The team list: the accessible mirror of the map (same projected state, as text). At >= 1280 px it is
 * a docked right rail; below that a sheet. Rows follow TEAMS order, then desk order; each row shows the
 * activity, the display form and an online dot only while that person is connected. Hover pulses the
 * avatar (or the desk plate); click opens the same menu as the map. No team counts.
 */
export function PeopleDirectory({ docked = false, onHide }: { docked?: boolean; onHide?: () => void }) {
  const { directory, session, ui, me } = useTown();
  const snap = useDirectory(directory);
  const roster = useRoster(session);
  const [q, setQ] = useState('');
  const t = ko.townUi.people;
  const players = useMemo(() => new Map<string, PlayerSnap>(roster.map((p) => [p.id, p])), [roster]);
  const online = onlineCount(roster);
  const query = q.trim().toLowerCase();
  const filtered = query ? snap.people.filter((p) => p.displayName.toLowerCase().includes(query)) : snap.people;
  const groups = railGroups(filtered, players, me.userId, me.officeTimeZone);

  const open = (row: RailRow, e: MouseEvent<HTMLButtonElement>) => {
    const root = e.currentTarget.closest('[data-town-root]');
    const rr = root?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    if (row.isMe) {
      ui.openStatus(r.left - (rr?.left ?? 0) - 8, r.top - (rr?.top ?? 0));
      return;
    }
    ui.openMenu(row.person.userId, r.left - (rr?.left ?? 0) - 250, r.top - (rr?.top ?? 0) + 10);
  };

  const body = (
    <>
      <input
        className={s.search}
        type="search"
        placeholder={t.search}
        aria-label={t.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {groups.length === 0 && <div className={s.empty}>{t.empty}</div>}
      {groups.map((g) => (
        <section key={g.teamId ?? 'none'} className={s.teamGroup} aria-label={g.label}>
          <h3 className={s.teamHeading}>
            <span className={s.teamSwatch} style={{ background: teamColor(g.teamId) }} aria-hidden="true" />
            {g.label}
          </h3>
          <ul className={s.personList} role="list">
            {g.rows.map((row) => (
              <Row key={row.person.userId} row={row} onOpen={open} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );

  if (docked) {
    return (
      <section className={s.railPeople} aria-label={t.railLabel}>
        <header className={s.railHeader}>
          <h2 className={s.railTitle}>
            {t.title}
            <span className={s.railCount}>{t.count(online)}</span>
          </h2>
          {onHide && (
            <button type="button" className={s.closeX} onClick={onHide} aria-label={t.hideRail} title={t.hideRail}>
              ›
            </button>
          )}
        </header>
        <div className={s.railBody} aria-live="polite" aria-relevant="text">
          {body}
        </div>
      </section>
    );
  }

  return (
    <Sheet title={`${t.title} · ${t.count(online)}`} onClose={ui.closeSheet}>
      {body}
    </Sheet>
  );
}
