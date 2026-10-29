# ADR 0002 — Pet text comes only from the employee's own Claude

Status: accepted (2026-10-29)

## Decision

ENU Den has no company API key and makes no server-side LLM calls. Pet bubbles show text written by the owner's
Claude through `post_pet_nudges` (or the title of a Claude-authored to-do), verbatim. ENU Den only decides _when_
(`packages/domain/src/nudge-policy.ts`). Text that violates the publishing rules (personal data, links, too long)
is rejected with a reason so Claude rewrites it; ENU Den never edits it. System information (due time, link
state) is rendered outside the bubble as UI.

## Enforcement

ESLint `no-restricted-imports` + `scripts/verify-policy.sh` (CI) block LLM SDKs; `BubblePresenter` only accepts
candidates loaded from Claude-authored rows; unlinked pets sleep (icon), they never "speak".

## Addendum (2026-10-29): town visualization ([ADR 0004](0004-town-is-a-visualization.md))

- The fifth tool, `post_activity`, carries **no free text**: only enums (`now.kind`, `schedule[].kind`), times and
  opaque refs. Refs are never shown; ENU Den keeps only a keyed daily hash to match colleagues' own reports. With no
  text to rewrite, validation only rejects (`invalid_time`, `unsupported`) or normalizes time (`now.until` defaults to
  90 minutes and is capped at 120, like `resolveNudgeTimes`).
- Text on the map is one of: ENU Den UI text (labels such as `검토 중 · Claude 보고` from `apps/web/src/i18n/ko.ts`),
  human-typed text (상태 문구, chat), or the existing verbatim work log. There is no Claude-written headline or label.
- Pet bubbles keep this ADR's rules. They show only during office hours, and colleagues see no sign of them (the
  shared `…` indicator is never set: a bubble starts only while the owner's tab is visible, so its onset would reveal
  the owner's attention, which [ADR 0004](0004-town-is-a-visualization.md) rules out).

## Addendum (2026-10-29): pet replies ([ADR 0005](0005-enu-den-messenger-and-pets.md))

- Sources of pet text are now: `post_pet_nudges` (optionally aimed at a `pet_id`), the title of a Claude-authored
  to-do, and **pet replies** written by the owner's Claude through the sixth connector tool `post_pet_reply` or the
  `reply` tool of the owner's local `enu-den-channel` plugin.
- Both reply paths use one service and `preparePetReplyText`: rejected with field-level reasons, never rewritten.
  Every reply follows the publishing rules (no personal data, no links, length) whatever its visibility.
- A reply always answers an owner message. Pets never start a conversation; only nudges are proactive, under every
  rule of `nudge-policy.ts`.
- Timing: a reply may arrive whenever the owner's own Claude Code session answers through the channel, after hours
  included, because the owner started the exchange. Connector replies (scheduled or interactive) are accepted only in
  office hours. Town bubbles stay quiet after hours.
- The channel plugin is a relay: no model call, no LLM SDK (`verify-policy.sh` and ESLint cover
  `packages/pet-channel`). Role instructions are owner input to the owner's Claude, never pet text.
- Pet replies are shown in the pet's room, never as town bubbles or on the map.
