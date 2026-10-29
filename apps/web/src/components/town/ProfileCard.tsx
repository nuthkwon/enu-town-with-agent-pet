'use client';

import { teamLabel, type LinkState, type ProfileCardDto } from '@enu/shared';
import { AvatarSprite } from '@/components/sprites';
import { Button } from '@/components/ui';
import { teamColor } from '@/game/directory';
import { ko } from '@/i18n/ko';
import { useOfficeOpen, useRoster } from '@/realtime/useRealtime';
import { api } from './api';
import { Sheet } from './Chrome';
import { formatAbsolute, formatRelative } from './format';
import { useFetch, useNow } from './hooks';
import { useTown } from './TownContext';
import { profileStatus } from './townModel';
import { WorkLogView } from './WorkLogPanel';
import s from './town.module.css';

export function effectiveLinkState(linkState: LinkState, stale: boolean): LinkState {
  return linkState === 'linked' && stale ? 'stale' : linkState;
}

export function LinkBadge({ state }: { state: LinkState }) {
  return (
    <span className={s.teamChip}>
      <span className={`${s.linkDot} ${s[`link-${state}`]}`} aria-hidden="true" />
      {ko.linkState[state]}
    </span>
  );
}

/**
 * Profile of a colleague (GET /api/v1/users/:id/card, which carries no status or activity times) plus
 * what the town shows about them right now (the projected Player fields; `online` drives the dot).
 */
export function ProfileCard({ userId }: { userId: string }) {
  const { ui, session, me } = useTown();
  const roster = useRoster(session);
  const officeOpen = useOfficeOpen(session);
  const now = useNow();
  const { data, error, loading, reload } = useFetch<ProfileCardDto>(api.card(userId));
  const t = ko.townUi.profile;
  const player = roster.find((p) => p.id === userId);
  const person = data?.person;
  const name = player?.name || person?.displayName || '';
  const link = person ? effectiveLinkState(person.linkState, data?.stale ?? false) : null;
  const isMe = userId === me.userId;
  const status = profileStatus(player, officeOpen, me.officeTimeZone);

  return (
    <Sheet title={t.title} onClose={ui.closeSheet}>
      {loading && !data && <div className={s.empty}>{ko.common.loading}</div>}
      {error && (
        <div className={s.empty}>
          {t.notFound}{' '}
          <Button variant="ghost" size="sm" onClick={reload}>
            {ko.common.retry}
          </Button>
        </div>
      )}
      {person && (
        <>
          <div className={s.profileHead}>
            <AvatarSprite preset={person.avatar} scale={3} label={name} />
            <div style={{ minWidth: 0 }}>
              <p className={s.profileName}>{name}</p>
              <span className={s.teamChip}>
                <span
                  className={s.teamSwatch}
                  style={{ background: teamColor(person.team) }}
                  aria-hidden="true"
                />
                {teamLabel(person.team) || t.noTeam}
              </span>
            </div>
          </div>
          <dl className={s.facts}>
            {person.title && (
              <>
                <dt>{t.jobTitle}</dt>
                <dd>{person.title}</dd>
              </>
            )}
            {person.roleNote && (
              <>
                <dt>{t.role}</dt>
                <dd>{person.roleNote}</dd>
              </>
            )}
            <dt>{t.status}</dt>
            <dd>
              {status.online && (
                <>
                  <span className={s.onlineDot} aria-hidden="true" />{' '}
                  <span className="visually-hidden">{t.online}</span>
                </>
              )}
              {status.text}
            </dd>
            {person.deskId && (
              <>
                <dt>{t.desk}</dt>
                <dd>{person.deskId}</dd>
              </>
            )}
            {link && (
              <>
                <dt>{t.link}</dt>
                <dd>
                  <LinkBadge state={link} />
                  <p className={s.explain}>{ko.linkStateHelp[link]}</p>
                </dd>
              </>
            )}
            {isMe && (
              <>
                <dt>{t.lastUpdated}</dt>
                <dd>
                  {me.lastWorkLogAt
                    ? `${formatRelative(me.lastWorkLogAt, now)} · ${formatAbsolute(me.lastWorkLogAt, now)}`
                    : ko.common.never}
                </dd>
              </>
            )}
          </dl>
          <div className={s.actionRow}>
            <Button size="sm" onClick={() => ui.openWorkLog(userId)}>
              {ko.townUi.menu.now}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => ui.openPastChats(userId)}>
              {ko.townUi.menu.pastChats}
            </Button>
            {!isMe && (
              <Button size="sm" variant="secondary" onClick={() => ui.openDm(userId)}>
                {ko.townUi.menu.dm}
              </Button>
            )}
          </div>
          <div className={s.section}>
            <h3 className={s.sectionTitle}>{t.latestLog}</h3>
            {data?.latestLog ? (
              <WorkLogView log={data.latestLog} now={now} />
            ) : (
              <div className={s.empty}>{t.noLog}</div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
