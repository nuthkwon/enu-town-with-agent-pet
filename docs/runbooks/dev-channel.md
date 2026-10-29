# Testing the Claude Code pet channel locally

The pet channel (ADR 0006) is a local stdio plugin, so unlike the connector it works against `localhost`.

## 1. Run ENU Den and pair this computer

1. Start the stack: `pnpm dev` (web on `http://localhost:3000`), sign in with a dev user and finish `/welcome`.
2. Create a pairing code (until the settings page exists, from the browser console on any ENU Den page):
   `await (await fetch('/api/v1/me/pet-channel/pairing-codes', { method: 'POST' })).json()`.
3. Pair from a terminal (the token goes to a scratch home, not your real one):

   ```bash
   export ENU_DEN_URL=http://localhost:3000
   export ENU_DEN_CHANNEL_HOME="$PWD/.dev-channel"
   node claude/plugins/enu-den-channel/server/den-channel.mjs pair K7QF-3MXP
   node claude/plugins/enu-den-channel/server/den-channel.mjs status
   ```

## 2. Start a Claude Code session on the channel

Development channels are not on the organization allow list, so load the server directly:

```bash
ENU_DEN_PET=1 ENU_DEN_URL=http://localhost:3000 ENU_DEN_CHANNEL_HOME="$PWD/.dev-channel" \
  claude --dangerously-load-development-channels server:den
```

with a project `.mcp.json` entry named `den` that runs `node claude/plugins/enu-den-channel/server/den-channel.mjs`.
Then write to your pet in ENU Den (`POST /api/v1/me/pets/:petId/messages`): the session receives a
`<channel source="den" kind="message" …>` event and answers with the `reply` tool; the reply shows in the pet room
(`GET /api/v1/me/pets/:petId/thread`).

## 3. Things to check by hand (spike S0, ADR 0006 "To verify")

- `/mcp` lists the plugin server as `plugin:enu-den-channel:den` once installed from the `enu-tech` marketplace, and
  `claude --channels plugin:enu-den-channel@enu-tech` registers it.
- The permission ids of `reply` and `status` match the managed example
  (`claude/managed-settings/claude-code.managed.example.json`).
- `${ENU_DEN_URL:-…}` and `${ENU_DEN_PET:-0}` expand in the plugin `.mcp.json`.
- A plain `claude` session starts the server inactive: no tools, no requests in the web log.
- Where Claude Code keeps installed plugins (the `enu-pet` function in the setup skill looks under
  `~/.claude/plugins/cache/enu-tech/enu-den-channel/`).

## Automated checks (no Claude needed)

- `pnpm --filter @enu/pet-channel test` — the committed bundle over stdio as a 2025-era client, against a fake ENU Den:
  inactive mode, the channel capability, events, reply and the unpaired notice.
- `pnpm --filter @enu/web test:int` — pairing, the bearer-only routes, claims, long-poll wake-up, replies, unpairing.
- `pnpm --filter @enu/pet-channel bundle && git diff --exit-code claude/plugins/enu-den-channel/server` — the bundle
  matches the source (CI runs this).
