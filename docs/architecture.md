# ENU Town architecture

```
 employee browser ──HTTPS──┐                ┌── employee's own Claude (claude.ai / Cowork cloud / Claude Code)
                           ▼                ▼        egress 160.79.104.0/21
                      Caddy :443  (TLS, strips /colyseus, drops _authToken from logs)
            /colyseus/* │                           │  /, /api/*, /.well-known/*
                        ▼                           ▼
              realtime :2567  ◄──LISTEN──  Postgres  ◄──►  web :3000
              Colyseus room office-606     enu_town_events  Next 16: pages, Better Auth (Google + OAuth AS),
              movement · pets · chat ·                      /api/mcp (MCP tools), /api/v1 REST, realtime ticket
              owner-only pet bubbles               ▲
                                            worker (pg-boss cron: nudge expiry, link state, retention, auth cleanup)
```

## Identity
- **Sign-in:** Google only, restricted to `ALLOWED_GOOGLE_HD`. Checks happen at five points:
  - Google's Internal consent screen
  - the verified `hd` claim in Better Auth
  - `validateUserInfo`
  - DB hooks
  - per-request session checks
- **Realtime:** the web app mints a 60-second HS256 ticket (aud `enu-town-realtime`). The Colyseus `onAuth` verifies it on the matchmake request and re-reads the user from the DB.
- **Claude connector:** ENU Town is the OAuth 2.1 authorization server (Better Auth `mcp()` + `cimd()` + `jwt()`). Access tokens are ES256 JWTs with `aud` = `https://<host>/api/mcp`. `resolveMcpCaller` rejects a token in three cases:
  - the user is inactive
  - the user is outside the domain
  - the token was issued before a revocation
  See [ADR 0001](adr/0001-auth-direction.md).

## Data flow of a check-in
1. Cowork runs the employee's scheduled task, which runs the `enu-town-checkin` skill.
2. The skill calls `get_my_context`. Outside work hours this returns `skip` and the skill stops.
3. `post_work_log` upserts the day's log, keyed by `(user, local date)`.
4. `upsert_todos` upserts by `external_ref`.
5. `post_pet_nudges` queues bubble text, which is shown verbatim.
6. Each write commits together with `NOTIFY enu_town_events`.
7. The realtime `DbEvents` listener reloads the owner's candidates.
8. `NudgeScheduler` (rules in `packages/domain/src/nudge-policy.ts`) chooses when to show a bubble: on join, on idle, or when something is due. It then sets the `.view()` bubble fields on the owner's pet. Only the owner's `StateView` contains their pet, so colleagues receive just `indicator = 1` ("…").
9. When a colleague clicks the avatar, the profile card calls `/api/v1/users/:id/card`, which only returns logs that pass `canViewLog`.

## Packages
See `CLAUDE.md` for the package map. The key invariants live in pure functions with unit tests:

| File | Invariant |
|---|---|
| `packages/domain/src/visibility.ts` | Who may see logs and chat summaries |
| `packages/domain/src/worklog-upsert.ts` | Owner edits, deletes and visibility always win |
| `packages/domain/src/validation.ts` | Text that breaks the rules is rejected, never rewritten |
| `packages/domain/src/nudge-policy.ts` | When a bubble may show (quiet hours, interval, daily cap, focus mode) |
| `packages/domain/src/link-state.ts` | Not linked / linked / stale |

## Map
Generated once from `packages/map/src/layouts/office-606.ts`. After that, `apps/web/public/assets/maps/office-606/office-606.tmj` is the source of truth, and you can edit it in Tiled. `pnpm map:check` validates the map:
- seats are reachable
- the partition around the CEO desk works
- the server room cannot be entered

It also writes the hash that realtime compares against.

## Art
All art is original pixel art defined in code (`packages/sprites`): avatars 32×32 in 4 directions with idle-bounce and hop-walk, fairy pets 24×24 with wings, office tiles 32×32 and effects. The web app renders avatar sheets on demand (`/api/sprites/avatar/:key`). The build writes the pets, tiles and default avatars to `apps/web/public/assets`.

## Phase 2 seam
`computeProximityGroups` in `packages/map/src/proximity.ts` and a no-op media provider are the hooks for adding LiveKit proximity voice and video later.
