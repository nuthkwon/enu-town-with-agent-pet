# ENU Den — repository guide for Claude

ENU Den is ENU-Tech's internal messenger for A동 606호 (14 people). Everyone chats with their own fairy pets (up to 5
each). A pet's replies are written **only by that employee's own Claude**: Claude Code via the pet channel plugin, or a
check-in via our MCP connector (ADR 0005, 0006). Beside the chat is a live 2D town of teams working and interacting.
Nobody steers an avatar; a server director places everyone from their own signals (ADR 0004). Every pet follows its
owner's avatar and shows to-do check-ins as bubbles. Read `docs/architecture.md`, `docs/design/messenger-spec.md` and
the ADRs in `docs/adr/` before changing auth, MCP tools, the pet channel, pet text or what colleagues and the town
show.

## Non-negotiable rules

- **No server-side LLM.** Never add `@anthropic-ai/*`, `openai`, `ai`, `@ai-sdk/*`, LangChain, etc. Pet bubbles and pet
  replies show Claude-authored text verbatim; ENU Den only decides _when_ and never writes for a pet. `scripts/verify-policy.sh` + ESLint enforce this.
- **Never rewrite Claude's text.** Policy violations (PII, URLs, too long) are _rejected_ with field-level reasons so
  Claude rewrites them (`packages/domain/src/validation.ts`). Only meaning-preserving normalization (NFC, invisible
  and control characters) is allowed. System information (due time, link state) is drawn _outside_ the bubble.
- **Never touch claude.ai credentials.** ENU Den is the OAuth server for its own MCP connector; Claude logs in to us.
- **MCP tools never set `requiresUserInteraction`** (unattended scheduled runs would stall) and never take a user id
  (or a colleague's name or email).
- **Visibility** is decided only in `packages/domain/src/visibility.ts` (`canViewLog`, `canViewChatSummary`,
  `effectiveVisibility`, `canShareActivity`, `canShowLive`, `canViewLogTimestamps`, `projectForColleagues`, `canViewPet`,
  `canChatWithPet`, `canViewPetPrivateFields`, `canViewPetMessage`, `petDefaultVisibility`, `petMessageVisibility`,
  `petReplyVisibility`, `canListWorkLogEntry`, `canShowWorkLogEntryTime`). Claude may lower visibility, never raise it above the owner default; only the owner turns
  activity sharing on.
- **Pet conversations.** Only the owner writes to a pet. Colleagues see company messages from the same day, **dates
  only**. Their DTOs have no times, sources, answer, read or typing state, channel liveness or companion mood. A reply
  is hidden whenever its question is. Pet chat defaults to company: the owner can lower it per pet or per message,
  and Claude can only lower it. Text with PII never goes out company-wide.
- **Pet channel (ADR 0006).** The plugin is inert without `ENU_DEN_PET=1`. It has no pair tool; only the person pairs,
  in a terminal (`enu-pet pair`). Tokens are stored as hashes. Whether a channel is live is kept only in web memory:
  never stored, NOTIFY'd, logged or audited. Polls, replies and reads are not audited. Connector (MCP) replies are
  allowed only in office hours; replies over the owner's own channel are allowed at any time.
- **Work overview (ADR 0007).** The one cross-person feed is of work-log changes written by each person's own Claude:
  company, unedited logs of active authors who accepted the current notice. `HH:MM` only for today's office-hours
  writes of authors who share activity; everything else one digest per person per day (no write counts or order).
  Owner edits and deletes remove entries; write times are kept for the current office day only; live pushes only in
  office hours. No presence, status or `now` entries, no rankings, no list of people without a log.
- **Avatars are never steered.** Every avatar state comes from `resolveActivity` + `projectForColleagues` over real
  inputs (the owner's status, an open town, their Claude's calendar blocks) — never fabricate motion or activity.
  Claude's `now` report and the work log only label an avatar or desk plate; people are grouped only when their own
  Claudes report the same ref (meetings need 3 or more).
- **No presence/activity history.** `activity_reports` is current-day only; no activity metadata in audits and no
  per-user connection lines in logs. No attendance report, admin activity view or presence job (ADR 0004).
- **Colleagues' state is shown only during office hours** (business days 08:30–19:30 in `APP_TIMEZONE`); outside them
  the shared state is neutral for everyone.
- **Real names are never committed** (public repo). The seat roster lives in `config/seats.local.json` (gitignored);
  commit only `config/seats.example.json` with pseudonyms.
- Google sign-in is restricted to `ALLOWED_GOOGLE_HD` (default `enu-tech.co.kr`) via the verified `hd` claim.

## Layout

- `apps/web` — Next 16 (App Router, `src/`): the messenger shell `app/(den)` (pet rooms, new-pet wizard, colleagues'
  read-only rooms, 전체 방/DM, town panel), `/town` full screen, Better Auth (+ MCP OAuth AS), `/api/mcp`, `/api/v1/*`
  (incl. bearer-only `/api/v1/pet-channel/*`), Phaser client.
- `apps/realtime` — Colyseus 0.18 server (room `office-606`): director (server-placed avatars), pets, chat, pet bubbles
  (StateView).
- `apps/worker` — pg-boss cron jobs (expiry, link state, retention, auth cleanup) + `migrate` entry.
- `apps/e2e` — Playwright tests (uses the preinstalled Chromium; `@playwright/test` pinned to 1.63.0); `demo/` records
  the usage demo video against a local demo stack (not in CI; pseudonyms only).
- `packages/shared` — constants, Asia/Seoul time helpers, text hygiene, zod schemas (MCP I/O, events, REST, env).
- `packages/domain` — pure business rules (visibility, activity precedence and groups, work-log upsert, link state,
  nudge policy, validation). No clocks or randomness: callers pass `now`.
- `packages/protocol` — Colyseus schema state + message types shared by web and realtime.
- `packages/map` — Tiled `.tmj` parsing, collision grid, A*, zones/desks, director spots; generator for the 606호 map
  (ㄱ-shaped team desks, R1 executive desk).
- `packages/sprites` — code-defined pixel art → PNG sprite sheets (avatars, pets with tints, companion expression
  sheets, office tiles).
- `packages/db` — Drizzle schema, migrations, client, NOTIFY helper, seeds.
- `packages/auth` — Better Auth configuration factory. `packages/mcp-tools` — the six MCP tools (+ `postPetReplies`, the reply core shared with the pet channel).
- `packages/pet-channel` — the Claude Code channel plugin (stdio server `den`, tools `reply`/`status`, `enu-pet` CLI),
  bundled into `claude/plugins/enu-den-channel/server/den-channel.mjs`. Commit the bundle; CI checks that it is fresh.
- `claude/` — Claude org plugins: `enu-den` (skills `enu-den-checkin`, `enu-den-setup`) and `enu-den-channel`.
  `docs/` — runbooks (Korean).

## Conventions

- TypeScript 6 strict, ESM everywhere, `moduleResolution: Bundler`. Internal packages export TS source
  (`"exports": "./src/index.ts"`); Next transpiles them, realtime/worker are bundled with tsdown, scripts run with tsx.
- Use `import type` for types. Prefer small pure functions in `packages/domain` with unit tests.
- Timezone: always use helpers in `packages/shared/src/time.ts` (default `Asia/Seoul`); never `new Date().getDay()`
  for business logic. The work-log key is the owner's local date (`localDateKey`). Town rules (office hours,
  `activity_reports.period_key`, manual-status expiry) use `APP_TIMEZONE`, never owner time zones.
- UI strings are Korean and live in `apps/web/src/i18n/ko.ts`.
- Render user/Claude text as plain text only (React text nodes / Phaser Text). No `dangerouslySetInnerHTML`.
- **Do not write `\uXXXX` escape sequences through shell heredocs** — the tooling may turn them into literal
  characters. Build special code points with `String.fromCharCode(0x....)` instead.
- Versions are pinned in the `catalog:` of `pnpm-workspace.yaml`; add deps with `catalog:` entries.

## Commands

```bash
pnpm install                      # pnpm 12 (see packageManager)
pnpm check:policy && pnpm lint && pnpm typecheck && pnpm test
pnpm test:int                     # needs Postgres; DATABASE_URL_TEST must end with _test
pnpm --filter @enu/<pkg> test     # one package
pnpm sprites:build && pnpm map:check
pnpm --filter @enu/pet-channel bundle   # after changing packages/pet-channel (commit the bundle)
pnpm db:generate && pnpm db:migrate && pnpm seed:seats
pnpm dev                          # web :3000, realtime :2567, worker
pnpm test:e2e
```

Local Postgres (this dev container has PG 16): `pg_ctlcluster 16 main start`, then create `enu_den_dev`,
`enu_den_test` and (for `pnpm test:e2e`) `enu_den_e2e` databases. Compose uses Postgres 18; schema must stay compatible with 16+ (UUIDv7 generated in app).
