# ADR 0005 — ENU Den: a messenger where each employee talks to their own pets, answered by their own Claude

Status: proposed (2026-10-29). Go-live is blocked on the "Review before rollout" list in
[ADR 0004](0004-town-is-a-visualization.md#review-before-rollout), which this ADR extends. The contracts are in the
[messenger spec](../design/messenger-spec.md).

## Context

ADRs 0001–0004 describe a town-first product: each employee's pet showed bubbles written by their own Claude, and
the daily work log was the only Claude-written text colleagues could read. The owner decided on 2026-10-29 to:

- rename the product ENU Den (host `den.enu-tech.co.kr`);
- make it messenger-first: rooms with the owner's pets, the 전체 room and 1:1 DMs, with the existing non-steered
  town as a side panel;
- let every employee create several pets ("새 펫 만들기", like creating a bot in a bot messenger) that only they
  talk to, each answered by their own Claude;
- make the pet conversations visible to colleagues by default, on the same day, with dates but no times.

The deployment is a pilot with no data to preserve.

Constraints that stay: no server-side LLM (ADR 0002); ENU Den never touches claude.ai credentials (ADR 0001);
visibility is decided in one module and Claude may only lower it (ADR 0003); no steering, no presence or activity
history, colleagues' state only in office hours, one projection for everyone (ADR 0004).

Claude Code channels (research preview, checked 2026-10-29): a channel is an MCP server that Claude Code spawns
locally over stdio; it pushes `notifications/claude/channel` events into an open session and may expose a reply
tool. A remote HTTP connector cannot be a channel. Events arrive only while the session is open. On organization
plans an Owner must enable channels, and a custom channel plugin must be allow-listed in managed settings. The
details are in [ADR 0006](0006-claude-code-pet-channel.md).

## Decision

1. **Name.** The product is ENU Den in the UI, the docs and every brand identifier (the previous name is listed only
   in the cutover runbook); "town / 타운" stays the name
   of the map view. Connector auth cannot be edited after registration, so the connector is registered again and
   everyone reconnects (see the [cutover runbook](../runbooks/rename-enu-den.ko.md)).
2. **Messenger-first.** The left list holds the owner's pets (the default pet first), 전체, DMs and people; the
   centre is the conversation; the town is a collapsible panel with a full view on demand, under every ADR 0004
   rule. There are no per-team channels and no cross-person feed (the work-log feed of
   [ADR 0007](0007-work-overview.md) supersedes this for work logs).
3. **Pets.**
   - Every active employee has 1–5 pets. The default pet (the former single pet) is created at onboarding; it can be
     renamed and restyled but not deleted. Extra pets are created and deleted by the owner.
   - **Only the owner chats with their pets.** Pets never message colleagues, colleagues never message pets, and
     pets never talk to each other. A pet is addressed by an opaque id (UUIDv4), never by a user id, name or email.
   - Per-pet settings: name, look (pixel species and tint), **role instructions**, reply route (`channel`, `checkin`,
     `both`) and default visibility.
   - Role instructions are the owner's own text to the owner's own Claude. They are delivered only to that Claude,
     never shown to colleagues, admins or the town, never pet text, and they never widen what Claude may do.
4. **Only the owner's Claude writes pet text.** No server-side model (ADR 0002). Two paths share one service and one
   validator: text is rejected with field-level reasons and never rewritten, and every reply follows the company
   publishing rules (no personal data, no links, length limit) whatever its visibility.
   - **Live: the `enu-den-channel` Claude Code plugin** on the owner's computer relays the owner's messages into
     the owner's open session and posts the replies back ([ADR 0006](0006-claude-code-pet-channel.md)). It works
     whenever that session is open, after hours included, because the owner started the exchange.
   - **Fallback: the connector.** The scheduled check-in (and interactive Claude with the connector) reads unanswered
     messages from `get_my_context.pet_inbox` and answers with the sixth tool `post_pet_reply`, in office hours only.
   - A reply always answers an owner message. Pets never start a conversation; proactive text stays
     `post_pet_nudges` (optionally aimed at a pet) under the unchanged nudge policy.
5. **Visibility of pet conversations** (decided only in `packages/domain/src/visibility.ts`):
   - Each pet's default is the owner's profile default, `company` unless the owner lowers it; the owner can set a
     pet's default and hide or show any single message, and hide a pet's whole history at once.
   - Claude only lowers: a reply gets the lowest of the requested visibility, the pet's default and the visibility
     of the message it answers. When reading, a reply is visible only while its question is visible.
   - Colleagues see company messages from the same day on, with the **date only**: no time, no live push, no typing,
     read, pending or answered signal, no reply path, no placeholder for hidden messages, nothing from deactivated
     authors, 90 days of history. Ids are UUIDv4 so they carry no time.
   - Owner-only: role instructions, reply routes, exact times, to-dos, nudges and bubbles, the channel state, the
     companion's state.
   - Admins see exactly what colleagues see.
   - The re-consent step asks every employee for this choice explicitly (`pet_chat_sharing`).
6. **Presence (접속).** Online and drawn now means ENU Den is open (a realtime session in any view), still gated by
   `show_live`; the source label is `ENU Den 접속`. Tab visibility, which view is open and the channel state are
   never inputs. One realtime session per user stays.
7. **Companion.** The owner's pet is drawn large in its room and reacts with expression sprites (listening,
   thinking, talking, happy, sleeping). The state is computed on the owner's screen and never sent or stored.
8. **Town.** All of a person's pets follow their avatar, the default pet first. Bubbles stay owner-only per pet with
   no shared indicator; pet conversation text is never drawn on the map. Pet changes made after hours reach the
   town when it opens.
9. **Consent.** Privacy notice `2026-12`; everyone accepts it again, including the 펫 대화 공유 step (now `2027-02`,
   which adds the work overview of [ADR 0007](0007-work-overview.md) and the spells of
   [ADR 0008](0008-wizard-office-effects-and-sound.md)).
10. **HR review.** A dated conversation that colleagues can read the same day can be taken as an activity record.
    This ADR is the new ADR that ADR 0004 item 7 requires; the HR review in the extended list gates go-live.

## What changes in earlier ADRs

- 0001: the new name and host; the local channel plugin as a second kind of link.
- 0002: pet replies as a source of pet text; replies at any time through the channel, nudges in office hours.
- 0003: "No raw Claude conversations" reworded; visibility of pet conversations.
- 0004: `접속` = ENU Den open; several pets per person; the review list extended.

## Still forbidden

- A server-side LLM or company API key; reading, mirroring or searching claude.ai, Cowork or Claude Code
  conversations; the Compliance API; touching claude.ai credentials.
- Tools that set `requiresUserInteraction`, take a user id, a colleague's name or email, or send anything to a
  colleague. ENU Den approving tool use on an employee's computer (no permission relay).
- Presence or activity history, attendance reports, admin activity views, presence jobs, town replay, tab visibility
  as presence, per-user connection lines in logs (channel polls included).
- Times, typing, read or live signals for colleagues in pet rooms; a cross-person feed of anything but work logs
  ([ADR 0007](0007-work-overview.md)); steering avatars; Claude-written text on the map.

## Consequences

- Six connector tools; `post_pet_reply` must be Always allow for Enterprise roles or scheduled runs stall.
- An optional owner-installed local component for Claude Code users. Others get replies only from the check-in
  (office hours, up to an hour later), and the UI says so.
- New data with its own retention (pet conversations 90 days), export and deletion.
- A dependency on a research-preview feature. The fallback must stay sufficient on its own.

## Not chosen

- A server-side model answering pets (ADR 0002; a company key and a voice that is not the owner's Claude).
- Mirroring the owner's Claude conversations or using the Compliance API (surveillance; ADRs 0001, 0003).
- The remote connector as a channel or a stateful MCP push (channels are local stdio only).
- Permission relay through ENU Den (a server compromise would approve tool use on every employee's computer).
- Colleagues talking to someone's pet, pets messaging colleagues, shared pets (one person's Claude acting toward
  another person; a prompt-injection path).
- Per-team channels or a cross-person team feed (comparative and history-like, town spec D13/Q6). Superseded for
  work logs by [ADR 0007](0007-work-overview.md).
- Showing role instructions to colleagues (personal free text, not needed to read replies).
- A unique species for every pet (16 species, up to 70 pets); the default pet keeps a person's identity on the map.
- Next-day release and an after-hours private default: considered for P4/P5; the owner chose same-day visibility and
  one default, with dates only and no live signals, subject to the HR review.
