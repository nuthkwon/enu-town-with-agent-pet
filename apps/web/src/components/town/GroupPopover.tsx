'use client';

import { formatLocalHm } from '@enu/shared';
import { teamColor } from '@/game/directory';
import { displayForm, groupsOf } from '@/game/logic/presence';
import { ko } from '@/i18n/ko';
import { useRoster } from '@/realtime/useRealtime';
import { Popover } from './Chrome';
import { useDirectory } from './hooks';
import { useTown } from './TownContext';
import s from './town.module.css';

/**
 * A meeting chip or group link was clicked: kind, `~HH:MM`, members with team dots and each member's
 * `지금 하는 일` link. Groups exist only through mutual corroboration (every member's own Claude reported
 * the same ref and every member shares activity), so nothing here is a claim about anyone else.
 */
export function GroupPopover({ groupId, x, y }: { groupId: string; x: number; y: number }) {
  const { session, directory, ui, me } = useTown();
  useDirectory(directory);
  const roster = useRoster(session);
  const group = groupsOf(roster).find((g) => g.id === groupId);
  const t = ko.townUi.group;
  const tz = me.officeTimeZone;
  const title = group?.family === 'meeting' ? t.meetingTitle : t.workTitle;
  const until = group && group.until > 0 ? ko.townUi.until(formatLocalHm(new Date(group.until), tz)) : '';
  return (
    <Popover
      x={x}
      y={y}
      onClose={ui.closePopover}
      label={group ? t.label(title, group.members.length) : title}
    >
      <div className={s.popoverHeader}>
        <div className={s.popoverTitle}>
          {title}
          {group ? ` · ${t.members(group.members.length)}` : ''}
          {until ? ` · ${until}` : ''}
        </div>
      </div>
      {!group ? (
        <p className={s.menuHint}>{ko.townUi.loadFailed}</p>
      ) : (
        <ul className={s.groupMembers}>
          {group.members.map((m) => {
            const person = directory.person(m.id);
            const form = displayForm(m, tz);
            return (
              <li key={m.id} className={s.groupMember}>
                <span
                  className={s.teamSwatch}
                  style={{ background: teamColor(person?.team) }}
                  aria-hidden="true"
                />
                <span className={s.groupMemberMain}>
                  <span className={s.personName}>{m.name || person?.displayName}</span>
                  {form && <span className={s.personSub}>{form}</span>}
                </span>
                <button
                  type="button"
                  className={s.linkButton}
                  data-autofocus={m.id === group.members[0]?.id ? true : undefined}
                  onClick={() => (m.id === me.userId ? ui.openStatus() : ui.openWorkLog(m.id))}
                >
                  {t.now}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={s.menuHint}>{t.help}</p>
    </Popover>
  );
}
