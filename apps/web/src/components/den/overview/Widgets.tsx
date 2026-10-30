'use client';

import { TASK_STATUSES, type OverviewTodayDto } from '@enu/shared';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ui';
import { teamColor } from '@/game/directory';
import { groupChipText } from '@/game/logic/presence';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import { useOfficeOpen, useRoster } from '@/realtime/useRealtime';
import { blockersByTeam, byTeam, liveTownSummary, teamTotals } from '../model/overview';
import o from './overview.module.css';

/** The four widgets of the overview popup (ADR 0007). Team order is fixed; nothing is ranked. */

const t = ko.den.overview;
const teamStyle = (team: string | null) => ({ '--team': teamColor(team) }) as CSSProperties;

function Widget({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={o.widget} aria-labelledby={id}>
      <h3 id={id} className={o.widgetTitle}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Team today: the people with a visible log today, their summary and tasks (nobody listed for having none). */
export function TeamTodayWidget({ today }: { today: OverviewTodayDto | null }) {
  const groups = byTeam(today?.members ?? []);
  return (
    <Widget id="overview-team-today" title={t.teamToday.title}>
      {!today ? (
        <p className={o.muted}>{t.loading}</p>
      ) : groups.length === 0 ? (
        <p className={o.muted}>{t.teamToday.empty}</p>
      ) : (
        groups.map((g) => (
          <div key={g.team ?? 'none'} className={o.teamBlock} style={teamStyle(g.team)}>
            <h4 className={o.teamName}>{g.label}</h4>
            <ul className={o.people}>
              {g.items.map((m) => (
                <li key={m.userId} className={o.person}>
                  <div className={o.personHead}>
                    <span className={o.who}>{t.byClaude(m.authorName)}</span>
                    {m.lastUpdate && <span className={o.time}>{t.lastUpdate(m.lastUpdate)}</span>}
                  </div>
                  {m.summary && <p className={o.summary}>{m.summary}</p>}
                  {m.tasks.length === 0 ? (
                    <p className={o.muted}>{t.teamToday.noTasks}</p>
                  ) : (
                    <ul className={o.tasks}>
                      {m.tasks.map((task, i) => (
                        <li key={i}>
                          <span className={cx(o.status, o[`status_${task.status}`])}>
                            {ko.taskStatus[task.status]}
                          </span>{' '}
                          {task.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Widget>
  );
}

/** Task totals by team: done, in progress, planned and blocked, in the fixed team order. */
export function TeamTotalsWidget({ today }: { today: OverviewTodayDto | null }) {
  const rows = teamTotals(today?.members ?? []);
  return (
    <Widget id="overview-totals" title={t.totals.title}>
      {!today ? (
        <p className={o.muted}>{t.loading}</p>
      ) : rows.length === 0 ? (
        <p className={o.muted}>{t.totals.empty}</p>
      ) : (
        <table className={o.totals}>
          <caption className={o.caption}>{t.totals.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.totals.team}</th>
              {TASK_STATUSES.map((st) => (
                <th key={st} scope="col">
                  {ko.taskStatus[st]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team ?? 'none'} style={teamStyle(r.team)}>
                <th scope="row" className={o.teamCell}>
                  {r.label}
                </th>
                {TASK_STATUSES.map((st) => (
                  <td key={st}>{r.counts[st]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Widget>
  );
}

/** Town now: from the live roster, in office hours only and never stored. */
export function LiveTownWidget({ session, timeZone }: { session: RealtimeSession; timeZone: string }) {
  const roster = useRoster(session);
  const officeOpen = useOfficeOpen(session);
  const sum = liveTownSummary(roster, officeOpen);
  const c = t.live.counts;
  return (
    <Widget id="overview-live" title={t.live.title}>
      {officeOpen === false ? (
        <p className={o.muted}>{t.live.closed}</p>
      ) : !sum ? (
        <p className={o.muted}>{t.live.loading}</p>
      ) : (
        <>
          <dl className={o.counts}>
            {(['meeting', 'focus', 'away', 'absent', 'online'] as const).map((k) => (
              <div key={k} className={o.count}>
                <dt>{c[k]}</dt>
                <dd>{t.live.people(sum[k])}</dd>
              </div>
            ))}
          </dl>
          <h4 className={o.subTitle}>{t.live.meetings}</h4>
          {sum.meetings.length === 0 ? (
            <p className={o.muted}>{t.live.noMeetings}</p>
          ) : (
            <ul className={o.meetings}>
              {sum.meetings.map((g) => (
                <li key={g.id}>
                  <span className={o.chip}>{groupChipText(g, timeZone)}</span>{' '}
                  {g.members.map((m) => m.name).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Widget>
  );
}

/** Today's blockers from company logs, grouped by team. */
export function BlockersWidget({ today }: { today: OverviewTodayDto | null }) {
  const groups = blockersByTeam(today?.members ?? []);
  return (
    <Widget id="overview-blockers" title={t.blockers.title}>
      {!today ? (
        <p className={o.muted}>{t.loading}</p>
      ) : groups.length === 0 ? (
        <p className={o.muted}>{t.blockers.empty}</p>
      ) : (
        groups.map((g) => (
          <div key={g.team ?? 'none'} className={o.teamBlock} style={teamStyle(g.team)}>
            <h4 className={o.teamName}>{g.label}</h4>
            <ul className={o.blockers}>
              {g.items.map((b, i) => (
                <li key={`${b.userId}-${i}`}>
                  {b.text} <span className={o.muted}>· {t.byClaude(b.authorName)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Widget>
  );
}
