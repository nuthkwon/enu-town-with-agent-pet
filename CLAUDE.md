# ENU Town — repository guide for Claude

ENU Town is ENU-Tech's internal Gather-style 2D office (A동 606호, 14 people). Each avatar is followed by a
fairy pet that shows to-do check-ins written **only by that employee's own Claude** (via our MCP connector).
Read `docs/architecture.md` and the ADRs in `docs/adr/` before changing auth, MCP tools or pet text.

## Non-negotiable rules
- **No server-side LLM.** Never add `@anthropic-ai/*`, `openai`, `ai`, `@ai-sdk/*`, LangChain, etc. Pet bubbles show
  Claude-authored text verbatim; ENU Town only decides *when*. `scripts/verify-policy.sh` + ESLint enforce this.
- **Never rewrite Claude's text.** Policy violations (PII, URLs, too long) are *rejected* with field-level reasons so
  Claude rewrites them (`packages/domain/src/validation.ts`). Only meaning-preserving normalization (NFC, invisible
  and control characters) is allowed. System information (due time, link state) is drawn *outside* the bubble.
- **Never touch claude.ai credentials.** ENU Town is the OAuth server for its own MCP connector; Claude logs in to us.
- **MCP tools never set `requiresUserInteraction`** (unattended scheduled runs would stall) and never take a user id.
- **Visibility** is decided only in `packages/domain/src/visibility.ts` (`canViewLog`, `canViewChatSummary`,
  `effectiveVisibility`). Claude may lower visibility, never raise it above the owner default.
- **Real names are never committed** (public repo). The seat roster lives in `config/seats.local.json` (gitignored);
  commit only `config/seats.example.json` with pseudonyms.
- Google sign-in is restricted to `ALLOWED_GOOGLE_HD` (default `enu-tech.co.kr`) via the verified `hd` claim.

## Layout
- `apps/web` — Next 16 (App Router, `src/`): pages, Better Auth (+ MCP OAuth AS), `/api/mcp`, `/api/v1/*`, Phaser client.
- `apps/realtime` — Colyseus 0.18 server (room `office-606`): movement, pets, chat, pet bubbles (StateView).
- `apps/worker` — pg-boss cron jobs (expiry, link state, retention, auth cleanup) + `migrate` entry.
- `apps/e2e` — Playwright tests (uses the preinstalled Chromium; `@playwright/test` pinned to 1.63.0).
- `packages/shared` — constants, Asia/Seoul time helpers, text hygiene, zod schemas (MCP I/O, events, REST, env).
- `packages/domain` — pure business rules (visibility, work-log upsert, link state, nudge policy, validation).
- `packages/protocol` — Colyseus schema state + message types shared by web and realtime.
- `packages/map` — Tiled `.tmj` parsing, collision grid, A*, zones/desks; generator for the 606호 draft map.
- `packages/sprites` — code-defined pixel art → PNG sprite sheets (avatars, pets, office tiles).
- `packages/db` — Drizzle schema, migrations, client, NOTIFY helper, seeds.
- `packages/auth` — Better Auth configuration factory. `packages/mcp-tools` — the four MCP tools.
- `claude/` — Claude org plugin (skills `enu-town-checkin`, `enu-town-setup`). `docs/` — runbooks (Korean).

## Conventions
- TypeScript 6 strict, ESM everywhere, `moduleResolution: Bundler`. Internal packages export TS source
  (`"exports": "./src/index.ts"`); Next transpiles them, realtime/worker are bundled with tsdown, scripts run with tsx.
- Use `import type` for types. Prefer small pure functions in `packages/domain` with unit tests.
- Timezone: always use helpers in `packages/shared/src/time.ts` (default `Asia/Seoul`); never `new Date().getDay()`
  for business logic. The work-log key is the owner's local date (`localDateKey`).
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
pnpm db:generate && pnpm db:migrate && pnpm seed:seats
pnpm dev                          # web :3000, realtime :2567, worker
pnpm test:e2e
```
Local Postgres (this dev container has PG 16): `pg_ctlcluster 16 main start`, then create `enu_town_dev` and
`enu_town_test` databases. Compose uses Postgres 18; schema must stay compatible with 16+ (UUIDv7 generated in app).
