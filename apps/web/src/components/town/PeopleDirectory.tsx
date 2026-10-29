'use client';

import { STATUS_LABEL_KO, type Status } from '@enu/protocol';
import { TEAMS, type PersonDto } from '@enu/shared';
import { useState } from 'react';
import { AvatarSprite } from '@/components/sprites';
import { teamColor } from '@/game/directory';
import { ko } from '@/i18n/ko';
import { useRoster } from '@/realtime/useRealtime';
import { Sheet } from './Chrome';
import { useDirectory } from './hooks';
import { useTown } from './TownContext';
import s from './town.module.css';

/** Groups people by team in TEAMS order; people without a team come last. */
export function groupByTeam(people: readonly PersonDto[]): { teamId: string | null; label: string; people: PersonDto[] }[] {
  const groups = TEAMS.map((t) => ({ teamId: t.id as string | null, label: t.label as string, people: [] as PersonDto[] }));
  const none = { teamId: null as string | null, label: ko.townUi.people.noTeam, people: [] as PersonDto[] };
  for (const p of people) {
    const g = groups.find((x) => x.teamId === p.team);
    (g ?? none).people.push(p);
  }
  const all = [...groups, none].filter((g) => g.people.length > 0);
  for (const g of all) g.people.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'));
  return all;
}

/** Everyone in the office grouped by team, online first-class; click opens the same context menu. */
export function PeopleDirectory() {
  const { directory, session, ui, me, bus } = useTown();
  const snap = useDirectory(directory);
  const roster = useRoster(session);
  const [q, setQ] = useState('');
  const online = new Map(roster.map((p) => [p.id, p]));
  const t = ko.townUi.people;
  const filtered = q.trim()
    ? snap.people.filter((p) => p.displayName.toLowerCase().includes(q.trim().toLowerCase()))
    : snap.people;
  const groups = groupByTeam(filtered);
  return (
    <Sheet title={`${t.title} · ${t.count(roster.length, snap.people.length)}`} onClose={ui.closeSheet}>
      <input
        className={s.search}
        type="search"
        placeholder={t.search}
        aria-label={t.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {groups.map((g) => (
        <section key={g.teamId ?? 'none'} className={s.teamGroup} aria-label={g.label}>
          <h3 className={s.teamHeading}>
            <span className={s.teamSwatch} style={{ background: teamColor(g.teamId) }} aria-hidden="true" />
            {g.label}
          </h3>
          <ul className={s.personList}>
            {g.people.map((p) => {
              const live = online.get(p.userId);
              const isMe = p.userId === me.userId;
              return (
                <li key={p.userId}>
                  <button
                    type="button"
                    className={`${s.person} ${live ? '' : s.offlinePerson}`}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      const root = e.currentTarget.closest('[data-town-root]');
                      const rr = root?.getBoundingClientRect();
                      const r = e.currentTarget.getBoundingClientRect();
                      if (live) bus.emit('camera:focus-user', { userId: p.userId });
                      if (isMe) {
                        ui.openStatus();
                        return;
                      }
                      ui.openMenu(p.userId, r.left - (rr?.left ?? 0) - 230, r.top - (rr?.top ?? 0) + 10);
                    }}
                  >
                    <span className={s.miniAvatar} style={{ width: 32, height: 32 }}>
                      <AvatarSprite preset={p.avatar} scale={1} label={p.displayName} />
                    </span>
                    <span className={s.personMain}>
                      <span className={s.personName}>
                        {p.displayName}
                        {isMe ? ` (${t.me})` : ''}
                      </span>
                      <span className={s.personSub}>
                        {[p.title, p.roleNote].filter(Boolean).join(' · ')}
                        {live?.statusText ? ` · ${live.statusText}` : ''}
                      </span>
                    </span>
                    <span className={s.presence}>
                      <span className={live ? s.onlineDot : s.offlineDot} aria-hidden="true" />
                      {live ? (STATUS_LABEL_KO[live.status as Status] ?? t.online) : t.offline}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
