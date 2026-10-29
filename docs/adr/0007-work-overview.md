# ADR 0007 — The work overview: a company-wide feed of work-log changes and a status view

Status: proposed (2026-10-30). Go-live is blocked on the "Review before rollout" list in
[ADR 0004](0004-town-is-a-visualization.md#review-before-rollout), which this ADR extends.

## Context

Work logs are written by each employee's own Claude and are company-visible by default
([ADR 0003](0003-visibility.md)). Until now colleagues read them one person at a time: the profile card, a person's
log list, the day cards in a default pet's room. ADR 0005 and the town spec (D13, open questions 4 and 6) ruled out a
cross-person feed, team counts and a blockers board because they can read as performance signals or as history, and
ADR 0003 kept exact log times for the owner only.

The owner decided on 2026-10-30 that everyone should be able to grasp the company's work at a glance:

- under the town panel of the messenger, a feed that accumulates what each person's Claude recorded;
- expanding it opens a full-screen popup (the messenger stays faintly visible behind it) with a larger town, the feed
  and widgets with a more detailed company status.

## Decision

1. **Source: work logs only.** A feed entry is made each time an employee's own Claude writes their work log
   (`post_work_log` created or updated) and something visible changed: a task added, a task's status changed, a
   blocker added, the summary changed. The text is Claude's, verbatim; the labels around it are ENU Den's. No entry is
   made for a private write, an unchanged check-in, or a write that only changes the visibility, the chat summary or
   a task reference. Owners' own edits make no entries.
2. **Who appears.** Only company-visible logs that are not deleted and not edited by their owner, of active authors
   who accepted the current privacy notice. The owner wins: making a log private hides its entries, editing or
   deleting it deletes them at once.
3. **Times.** An exception to ADR 0003's owner-only timestamps, for the feed only. `HH:MM` is shown only when all of
   these hold, checked when the feed is read:
   - the entry is from today's office day (`APP_TIMEZONE`);
   - it was written in office hours (business days 08:30–19:30, `kr_holidays`);
   - the author shares activity (`canShareActivity`), the same condition as the log sparkle in the town.

   Otherwise there is no time. Times are sent as `HH:MM` strings; no ISO timestamps, sequence numbers or sources leave
   the server, and ids are UUIDv4.

4. **Order that tells no timing.** Today's timed entries are listed one per write, newest first. Everything else
   (today's untimed writes and every past day) is merged into one digest per person per day, ordered by team, desk
   and name. Write counts and the order of writes within a day are never shown.
5. **Storage.** `work_log_entries` keeps the time of each write for the current office day only. The nightly purge
   merges every past day into one row per log and day without a time. Entries follow the work logs' retention
   (90 days) and are part of the owner's export.
6. **Widgets** in the overview popup:
   - **Team today:** the people with a visible log today and their summary and tasks. Nobody is listed for having no
     log.
   - **Task totals by team:** done, in progress, planned and blocked, in the fixed team order; no ranking, no
     per-person bars.
   - **Town now:** the meetings under way and how many people are in a meeting, focused, away or absent, and how many
     are online, computed in the browser from the live town projection, in office hours only and never stored.
   - **Blockers:** today's blockers from company logs, grouped by team.
7. **Live updates** while the office is open only: realtime broadcasts an empty `overview:changed` (throttled) and
   clients fetch again over REST. Nothing is pushed after hours.
8. **Everyone sees the same**, the owner included (the owner's exact times stay on `/me`). Admins have no extra view.
9. **Logs.** The overview routes leave no per-request lines in the edge logs.
10. **Consent.** Privacy notice `2027-01`; everyone accepts it again.
11. **HR review.** Feed times, team totals, the blockers board, and what untimed entries and weekend dates reveal
    about work outside office hours. This ADR is the new ADR that ADR 0004 item 7 requires; the review gates go-live.

## What changes in earlier ADRs

- 0003: exact work-log times stay owner-only in every log DTO; the feed shows `HH:MM` under item 3 only.
- 0004: P4 still holds for presence and activity; work-log write times are kept for the current office day only, like
  `activity_reports`. The review list gains this ADR.
- 0005: decision 2 ("no cross-person feed"), the matching "Still forbidden" line and the "Not chosen" entry are
  superseded for work logs.
- Town spec D13 and open questions 4 and 6: team counts and blockers are shown here, not on the map.

## Still forbidden

- Presence or activity history anywhere, the feed included: no meeting, online, status or Claude `now` entries.
- Times outside today's office hours, pushes after hours, write counts, rankings, per-person counts or charts, and a
  list of people without a log.
- Pet conversations, chat, Claude's chat summaries, `source` and task references in the feed.

## Consequences

- A new table, two read routes, one realtime message and the panel and popup UI.
- The overview is a stronger signal than one person's card; the review in item 11 decides whether it ships as is.

## Not chosen

- Times for all 90 days (reads as attendance).
- One line per write for past days (shows how often and in which order each person's Claude wrote).
- A board of people who have not logged today.
- Pet conversations or the 전체 room in the feed (the owner chose work logs only).
